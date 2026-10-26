const express = require("express");
const { authenticate, authorize, OWNER_LEVEL_ROLES } = require("../middleware/auth");
const { Op, fn, col, literal } = require("sequelize");
const {
  Remittance,
  BusModel,
  User,
  RemittanceExpense,
  Trip,
  Route,
  Ticket,
  PassengerCount,
  sequelize,
} = require("../models");
const {
  buildDailyForecast,
  buildUtilForecast,
} = require("../services/forecast/buildForecast");
const { buildInsights } = require("../services/insights/buildInsights");
const { findRemittanceDetail } = require("../services/remittance/findRemittanceDetail");

// Date columns can come back as "YYYY-MM-DD" strings or Date objects.
const dateKey = (d) =>
  typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().split("T")[0];

// Local (server timezone) YYYY-MM-DD — toISOString() would shift the day in UTC+8.
const localKey = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const router = express.Router();
router.use(authenticate, authorize(...OWNER_LEVEL_ROLES));

// GET /api/owner/dashboard
// Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD — filters the range-based KPIs and
// the daily passenger chart. Defaults to the current month when omitted.
router.get("/dashboard", async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const { from, to } = req.query;
    let rangeStart, rangeEnd;
    if (from && to && !isNaN(Date.parse(from)) && !isNaN(Date.parse(to))) {
      rangeStart = new Date(`${from}T00:00:00`);
      rangeEnd = new Date(`${to}T23:59:59.999`);
    } else {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
      rangeEnd = now;
    }
    // Comparison window: the immediately preceding period of equal length.
    const rangeMs = rangeEnd.getTime() - rangeStart.getTime();
    const prevRangeEnd = new Date(rangeStart.getTime() - 1);
    const prevRangeStart = new Date(prevRangeEnd.getTime() - rangeMs);

    // ── KPI: Net gross within the selected range ───────────────────────────
    const netGrossInRange =
      (await Remittance.sum("net_gross", {
        where: {
          status: "approved",
          submitted_at: { [Op.between]: [rangeStart, rangeEnd] },
        },
      })) || 0;
    const netGrossPrevRange =
      (await Remittance.sum("net_gross", {
        where: {
          status: "approved",
          submitted_at: { [Op.between]: [prevRangeStart, prevRangeEnd] },
        },
      })) || 0;

    // ── KPI: Total revenue (completed trips' grand_total) in the range ──
    const totalRevenueInRange =
      (await Trip.sum("grand_total", {
        where: {
          status: "completed",
          departure_time: { [Op.between]: [rangeStart, rangeEnd] },
        },
      })) || 0;

    // ── KPI: Passenger counts via raw SQL ─────────────────────────────────
    const [pcInRange] = await sequelize.query(
      `SELECT COALESCE(SUM(pc.count),0) AS total
       FROM passenger_counts pc
       JOIN trips t ON t.id = pc.trip_id
       WHERE t.departure_time BETWEEN :start AND :end`,
      {
        replacements: { start: rangeStart, end: rangeEnd },
        type: sequelize.QueryTypes.SELECT,
      },
    );
    const passengerCountInRange = Number(pcInRange.total) || 0;

    const [pcPrevRange] = await sequelize.query(
      `SELECT COALESCE(SUM(pc.count),0) AS total
       FROM passenger_counts pc
       JOIN trips t ON t.id = pc.trip_id
       WHERE t.departure_time BETWEEN :start AND :end`,
      {
        replacements: { start: prevRangeStart, end: prevRangeEnd },
        type: sequelize.QueryTypes.SELECT,
      },
    );
    const passengerCountPrevRange = Number(pcPrevRange.total) || 0;

    const passengerGrowth =
      passengerCountPrevRange > 0
        ? (
            ((passengerCountInRange - passengerCountPrevRange) /
              passengerCountPrevRange) *
            100
          ).toFixed(1)
        : null;

    // ── KPI: Bus utilisation ───────────────────────────────────────────────
    const totalBuses = await BusModel.count({ where: { status: "active" } });
    const busesInUseToday = await Trip.count({
      distinct: true,
      col: "bus_id",
      where: { 
        status: { [Op.in]: ["ongoing", "completed"] },
        departure_time: { [Op.between]: [todayStart, todayEnd] },
      },
    });
    const busUtilRate =
      totalBuses > 0 ? Math.round((busesInUseToday / totalBuses) * 100) : 0;

    // ── KPI: Remittance counts ─────────────────────────────────────────────
    const remittanceApproved = await Remittance.count({
      where: { status: "approved" },
    });
    const remittanceTotal = await Remittance.count();
    const remittancePending = await Remittance.count({
      where: { status: "submitted" },
    });
    const remittanceRejected = await Remittance.count({
      where: { status: "rejected" },
    });

    // ── Daily passenger volume within the selected range (raw SQL) ────────
    const dailyPassengersRaw = await sequelize.query(
      `SELECT t.departure_time::date AS date, COALESCE(SUM(pc.count),0) AS total
       FROM trips t
       LEFT JOIN passenger_counts pc ON pc.trip_id = t.id
       WHERE t.departure_time BETWEEN :start AND :end
       GROUP BY t.departure_time::date
       ORDER BY t.departure_time::date ASC`,
      {
        replacements: { start: rangeStart, end: rangeEnd },
        type: sequelize.QueryTypes.SELECT,
      },
    );

    // ── Route profitability (via trips) ───────────────────────────────────
    const routeProfit = await sequelize.query(
      `SELECT t.route_id, r.origin, r.destination,
              SUM(t.grand_total) AS revenue,
              COUNT(t.id) AS trip_count
       FROM trips t
       JOIN routes r ON r.id = t.route_id
       WHERE t.status = 'completed'
       GROUP BY t.route_id, r.origin, r.destination
       ORDER BY revenue DESC
       LIMIT 6`,
      { type: sequelize.QueryTypes.SELECT },
    );

    // ── Peak hour analysis (last 30 days) ─────────────────────────────────
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);
    const peakHoursRaw = await sequelize.query(
      `SELECT EXTRACT(HOUR FROM issued_at)::int AS hour,
              SUM(COALESCE(passenger_count, 1)) AS ticket_count
       FROM tickets
       WHERE issued_at >= :since
       GROUP BY EXTRACT(HOUR FROM issued_at)::int
       ORDER BY hour ASC`,
      {
        replacements: { since: thirtyDaysAgo },
        type: sequelize.QueryTypes.SELECT,
      },
    );

    // ── Weekday vs weekend passengers (last 12 weeks) ─────────────────────
    const twelveWeeksAgo = new Date(now);
    twelveWeeksAgo.setDate(now.getDate() - 84);
    const weekdayWeekendRaw = await sequelize.query(
      `SELECT EXTRACT(MONTH FROM t.departure_time) AS month,
              EXTRACT(DOW FROM t.departure_time) AS dow,
              COALESCE(SUM(pc.count),0) AS total
       FROM trips t
       LEFT JOIN passenger_counts pc ON pc.trip_id = t.id
       WHERE t.departure_time >= :since
       GROUP BY EXTRACT(MONTH FROM t.departure_time), EXTRACT(DOW FROM t.departure_time)
       ORDER BY month ASC`,
      {
        replacements: { since: twelveWeeksAgo },
        type: sequelize.QueryTypes.SELECT,
      },
    );

    // ── Remittance trend (last 12 months) ─────────────────────────────────
    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setMonth(now.getMonth() - 11);
    const remittanceTrend = await sequelize.query(
      `SELECT EXTRACT(YEAR FROM submitted_at) AS year,
              EXTRACT(MONTH FROM submitted_at) AS month,
              SUM(net_collection) AS net_collection,
              SUM(net_collection + cash_deposit) AS total_revenue,
              SUM(gross_income) AS gross_income
       FROM remittances
       WHERE status = 'approved' AND submitted_at >= :since
       GROUP BY EXTRACT(YEAR FROM submitted_at), EXTRACT(MONTH FROM submitted_at)
       ORDER BY year ASC, month ASC`,
      {
        replacements: { since: twelveMonthsAgo },
        type: sequelize.QueryTypes.SELECT,
      },
    );

    // ── Remittances in the range: approved revenue + cash variance ─────────
    const rangeFromKey = localKey(rangeStart);
    const rangeToKey = localKey(rangeEnd);
    const [remitRange] = await sequelize.query(
      `SELECT COALESCE(SUM(net_collection + cash_deposit), 0) AS revenue,
              COALESCE(SUM(cash_received - (net_collection + cash_deposit))
                FILTER (WHERE cash_received IS NOT NULL), 0) AS cash_variance
       FROM remittances
       WHERE status = 'approved' AND date BETWEEN :from AND :to`,
      {
        replacements: { from: rangeFromKey, to: rangeToKey },
        type: sequelize.QueryTypes.SELECT,
      },
    );

    // ── Daily total revenue of approved remittances in the range ──────────
    const remittanceDaily = await sequelize.query(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date,
              SUM(net_collection + cash_deposit) AS total_revenue
       FROM remittances
       WHERE status = 'approved' AND date BETWEEN :from AND :to
       GROUP BY date
       ORDER BY date ASC`,
      {
        replacements: { from: rangeFromKey, to: rangeToKey },
        type: sequelize.QueryTypes.SELECT,
      },
    );

    // ── Trip performance within the range (for insights) ──────────────────
    const [tripPerf] = await sequelize.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'completed') AS completed,
              COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
              COUNT(actual_departure_time) AS departures_recorded,
              AVG(EXTRACT(EPOCH FROM (actual_departure_time - departure_time)) / 60)
                FILTER (WHERE actual_departure_time IS NOT NULL) AS avg_delay_min
       FROM trips
       WHERE departure_time BETWEEN :start AND :end`,
      {
        replacements: { start: rangeStart, end: rangeEnd },
        type: sequelize.QueryTypes.SELECT,
      },
    );

    const insights = buildInsights({
      passengersInRange: passengerCountInRange,
      passengersPrevRange: passengerCountPrevRange,
      passengerGrowthPct: passengerGrowth,
      netGrossInRange,
      netGrossPrevRange,
      routeProfit,
      peakHours: peakHoursRaw,
      weekdayWeekend: weekdayWeekendRaw,
      busUtilisationRate: busUtilRate,
      totalBuses,
      busesInUseToday,
      remittancePending,
      tripsCompleted: Number(tripPerf?.completed) || 0,
      tripsCancelled: Number(tripPerf?.cancelled) || 0,
      avgDepartureDelayMin:
        tripPerf?.avg_delay_min != null ? Number(tripPerf.avg_delay_min) : null,
      tripsWithActualDeparture: Number(tripPerf?.departures_recorded) || 0,
    });

    return res.json({
      insights,
      range: {
        from: rangeFromKey,
        to: rangeToKey,
      },
      kpi: {
        net_gross_in_range: netGrossInRange,
        total_revenue_in_range: Number(totalRevenueInRange),
        passenger_count_in_range: passengerCountInRange,
        passenger_growth_pct: passengerGrowth,
        bus_utilisation_rate: busUtilRate,
        total_buses: totalBuses,
        buses_in_use_today: busesInUseToday,
        remittance_approved: remittanceApproved,
        remittance_total: remittanceTotal,
        remittance_pending: remittancePending,
        remittance_rejected: remittanceRejected,
        remittance_revenue_in_range: Number(remitRange?.revenue) || 0,
        remittance_cash_variance_in_range:
          Math.round((Number(remitRange?.cash_variance) || 0) * 100) / 100,
      },
      daily_passengers: dailyPassengersRaw,
      route_profit: routeProfit,
      peak_hours: peakHoursRaw,
      weekday_weekend: weekdayWeekendRaw,
      remittance_trend: remittanceTrend,
      remittance_daily: remittanceDaily,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
});

// GET /api/owner/remittances
router.get("/remittances", async (req, res) => {
  try {
    const remittances = await Remittance.findAll({
      include: [
        { model: BusModel, attributes: ["id", "bus_number", "plate_number"] },
        {
          model: User,
          as: "driver",
          attributes: ["id", "first_name", "last_name", "employee_id"],
        },
        {
          model: User,
          as: "conductor",
          attributes: ["id", "first_name", "last_name", "employee_id"],
        },
        {
          model: User,
          as: "approver",
          attributes: ["id", "first_name", "last_name"],
        },
      ],
      order: [["submitted_at", "DESC"]],
    });
    return res.json(remittances);
  } catch (error) {
    console.error("Error fetching remittances:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
});

// GET /api/owner/remittances/:id
// Full detail including each trip's tickets (same query the conductor page uses).
router.get("/remittances/:id", async (req, res) => {
  try {
    const remittance = await findRemittanceDetail({ id: req.params.id });
    if (!remittance)
      return res.status(404).json({ message: "Remittance not found." });
    return res.json(remittance);
  } catch (error) {
    console.error("Error fetching remittance:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/owner/forecast
// Forecasting & predictive analytics — ML (Random Forest) when enough data is
// available, falling back to statistical methods otherwise (see
// server/services/forecast/buildForecast.js).
// ═══════════════════════════════════════════════════════════════════════════
router.get("/forecast", async (req, res) => {
  try {
    const now = new Date();

    // ── 1. Daily passenger data – last 90 days ───────────────────────────
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(now.getDate() - 90);
    const dailyRaw = await sequelize.query(
      `SELECT to_char(t.departure_time::date, 'YYYY-MM-DD') AS date, COALESCE(SUM(pc.count),0) AS total
       FROM trips t
       LEFT JOIN passenger_counts pc ON pc.trip_id = t.id
       WHERE t.departure_time >= :since
       GROUP BY t.departure_time::date
       ORDER BY t.departure_time::date ASC`,
      {
        replacements: { since: ninetyDaysAgo },
        type: sequelize.QueryTypes.SELECT,
      },
    );

    // Build dense daily array (fill gaps with 0)
    const dailyMap = {};
    for (const r of dailyRaw) {
      dailyMap[dateKey(r.date)] = Number(r.total);
    }
    const dailyDense = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = localKey(d);
      dailyDense.push({
        date: key,
        passengers: dailyMap[key] ?? 0,
        dow: d.getDay(),
      });
    }

    // ── 2-4. Passenger trend + seasonality + 7-day forecast (ML or fallback) ─
    const passengerRows = dailyDense.map((d) => ({
      date: d.date,
      value: d.passengers,
    }));
    const passengerResult = buildDailyForecast(passengerRows, {
      daysAhead: 7,
      useSeasonalBlend: false,
    });
    const seasonalFactors = passengerResult.seasonalFactors;
    const passengerForecast7 = passengerResult.predictions.map((p) => ({
      date: p.date,
      predicted: p.predicted,
      dow: new Date(`${p.date}T00:00:00`).getDay(),
    }));

    // ── 5. Revenue data – last 90 days ───────────────────────────────────
    // Total Revenue of approved remittances (Net Collection + Cash Deposit), by remittance date.
    const revenueRaw = await sequelize.query(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date,
              COALESCE(SUM(net_collection + cash_deposit), 0) AS revenue
       FROM remittances
       WHERE status = 'approved' AND date >= :since
       GROUP BY date
       ORDER BY date ASC`,
      {
        replacements: { since: localKey(ninetyDaysAgo) },
        type: sequelize.QueryTypes.SELECT,
      },
    );

    const revMap = {};
    for (const r of revenueRaw) revMap[r.date] = Number(r.revenue);
    const revDense = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = localKey(d);
      revDense.push({ date: key, value: revMap[key] ?? 0 });
    }
    const revenueResult = buildDailyForecast(revDense, {
      daysAhead: 7,
      useSeasonalBlend: true,
    });
    const revenueForecast7 = revenueResult.predictions;

    // ── 7. Predicted revenue / passengers tomorrow (single KPI) ─────────
    const tomorrowDow = new Date(now);
    tomorrowDow.setDate(now.getDate() + 1);
    const predictedPassengersTomorrow = passengerForecast7[0]?.predicted ?? 0;
    const predictedRevenueTomorrow = revenueForecast7[0]?.predicted ?? 0;

    // Growth % relative to today's actual
    const todayKey = localKey(now);
    const todayPassengers = dailyMap[todayKey] ?? 0;
    const todayRevenue = revMap[localKey(now)] ?? 0;
    const passengerGrowthTomorrow =
      todayPassengers > 0
        ? (
            ((predictedPassengersTomorrow - todayPassengers) /
              todayPassengers) *
            100
          ).toFixed(1)
        : null;
    const revenueGrowthTomorrow =
      todayRevenue > 0
        ? (
            ((predictedRevenueTomorrow - todayRevenue) / todayRevenue) *
            100
          ).toFixed(1)
        : null;

    // ── 8. Bus utilisation forecast (ML or exponential-smoothing fallback) ──
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);
    const utilRaw = await sequelize.query(
      `SELECT t.departure_time::date AS date,
              COUNT(DISTINCT t.bus_id)::float / GREATEST(:total,1) * 100 AS util_pct
       FROM trips t
       WHERE t.departure_time >= :since AND t.status IN ('ongoing','completed')
       GROUP BY t.departure_time::date
       ORDER BY t.departure_time::date ASC`,
      {
        replacements: {
          since: ninetyDaysAgo,
          total: Math.max(
            1,
            await BusModel.count({ where: { status: "active" } }),
          ),
        },
        type: sequelize.QueryTypes.SELECT,
      },
    );
    const utilRows = utilRaw.map((r) => ({
      date: dateKey(r.date),
      value: Number(r.util_pct),
    }));
    const utilResult = buildUtilForecast(utilRows);
    const predictedUtilTomorrow = utilResult.predictedTomorrow;

    // ── 9. Peak hours forecast (average by hour across last 30 days) ──────
    const peakForecast = await sequelize.query(
      `SELECT sub.hour,
              AVG(sub.daily_count) AS avg_tickets
       FROM (
         SELECT DATE(issued_at) AS day,
                EXTRACT(HOUR FROM issued_at)::int AS hour,
                SUM(COALESCE(passenger_count, 1)) AS daily_count
         FROM tickets
         WHERE issued_at >= :since
         GROUP BY DATE(issued_at), EXTRACT(HOUR FROM issued_at)
       ) sub
       GROUP BY sub.hour
       ORDER BY avg_tickets DESC
       LIMIT 3`,
      {
        replacements: { since: thirtyDaysAgo },
        type: sequelize.QueryTypes.SELECT,
      },
    );

    // ── 10. Combined actual + forecast series (last 7 actual + next 7 pred) for chart
    const last7Actual = dailyDense
      .slice(-7)
      .map((d) => ({ date: d.date, value: d.passengers, type: "actual" }));
    const next7Forecast = passengerForecast7.map((d) => ({
      date: d.date,
      value: d.predicted,
      type: "forecast",
    }));
    const demandSeries = [...last7Actual, ...next7Forecast];

    // Same 14 days for revenue (last 7 actual + next 7 forecast), so the dashboard can
    // draw revenue as a second line over the passenger demand chart.
    const revenueSeries = [
      ...revDense
        .slice(-7)
        .map((d) => ({ date: d.date, value: d.value, type: "actual" })),
      ...revenueForecast7.map((d) => ({
        date: d.date,
        value: d.predicted,
        type: "forecast",
      })),
    ];

    return res.json({
      kpi_forecast: {
        predicted_passengers_tomorrow: predictedPassengersTomorrow,
        passenger_growth_pct_tomorrow: passengerGrowthTomorrow,
        predicted_revenue_tomorrow: predictedRevenueTomorrow,
        revenue_growth_pct_tomorrow: revenueGrowthTomorrow,
        predicted_bus_utilisation_tomorrow: predictedUtilTomorrow,
      },
      demand_series: demandSeries,
      revenue_series: revenueSeries,
      revenue_forecast_7d: revenueForecast7,
      peak_hours_forecast: peakForecast,
      seasonal_factors: seasonalFactors.map((f, i) => ({
        dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][i],
        factor: Number(f.toFixed(3)),
      })),
      forecast_method: {
        passengers: passengerResult.method,
        revenue: revenueResult.method,
        utilisation: utilResult.method,
      },
    });
  } catch (error) {
    console.error("Forecast error:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// REPORTS — GET /api/owner/reports/summary?from=&to=   (JSON preview)
//           GET /api/owner/reports/remittances?from=&to= (Excel download)
// Totals use APPROVED remittances only; the Remittances sheet lists every
// status so the owner can also see pending / rejected ones.
// ═══════════════════════════════════════════════════════════════════════════
const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (v) => Number(v) || 0;
const fullName = (u) => (u ? `${u.first_name} ${u.last_name}` : "");

async function loadReport(from, to) {
  const rows = await Remittance.findAll({
    where: { date: { [Op.between]: [from, to] } },
    include: [
      { model: BusModel, attributes: ["id", "bus_number", "plate_number"] },
      { model: User, as: "driver", attributes: ["id", "first_name", "last_name"] },
      { model: User, as: "conductor", attributes: ["id", "first_name", "last_name"] },
      { model: User, as: "approver", attributes: ["id", "first_name", "last_name"] },
      { model: RemittanceExpense, attributes: ["id", "expense_type", "amount"] },
    ],
    order: [["date", "ASC"], ["id", "ASC"]],
  });

  const approved = rows.filter((r) => r.status === "approved");
  const sum = (list, fn) => list.reduce((s, r) => s + fn(r), 0);

  const summary = {
    from,
    to,
    remittances: approved.length,
    gross_income: sum(approved, (r) => num(r.gross_income)),
    total_expenses: sum(approved, (r) => num(r.total_expenses)),
    net_gross: sum(approved, (r) => num(r.gross_income) - num(r.total_expenses)),
    driver_commission: sum(approved, (r) => Math.round(num(r.driver_commission))),
    conductor_commission: sum(approved, (r) => Math.round(num(r.conductor_commission))),
    net_collection: sum(approved, (r) => num(r.net_collection)),
    cash_deposit: sum(approved, (r) => num(r.cash_deposit)),
    total_revenue: sum(approved, (r) => num(r.net_collection) + num(r.cash_deposit)),
    cash_received: sum(approved, (r) => num(r.cash_received)),
    pending: rows.filter((r) => r.status === "submitted").length,
    rejected: rows.filter((r) => r.status === "rejected").length,
  };
  return { rows, approved, summary };
}

// Daily report laid out like the paper Teller's Report: one row per bus with
// gross income, one column per expense type, then the totals and the review
// status. The TOTAL row sums APPROVED remittances only (live SUMIF formulas).
const EXPENSE_COLUMNS = [
  ["officer", "Officer / Police"],
  ["toll_fees", "Toll Fees"],
  ["parking", "Parking"],
  ["ppa", "PPA"],
  ["washing", "Bus Washing"],
  ["diesel", "Diesel / Fuel"],
  ["caller_grand_terminal", "Caller (Grand Terminal)"],
  ["caller_calamba_terminal", "Caller (Calamba Terminal)"],
  ["pwd", "PWD / Senior Discount"],
  ["miscellaneous", "Miscellaneous"],
];

function buildDailySheet(wb, rows, day) {
  const PESO = '#,##0.00';
  const ws = wb.addWorksheet("Teller's Report", {
    views: [{ state: "frozen", xSplit: 3, ySplit: 7 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const heads = [
    "Bus #", "Driver", "Conductor", "Gross Income",
    ...EXPENSE_COLUMNS.map((c) => c[1]),
    "Total Expenses", "Net Gross", "Driver Commission", "Conductor Commission",
    "Net Collection", "Cash Deposit", "Total Revenue", "Cash Remitted", "Status",
  ];
  const lastCol = heads.length;
  const colL = (n) => ws.getColumn(n).letter;
  const statusCol = lastCol;
  const FIRST_DATA = 8;

  // Title block
  const titles = [
    ["JAPS TRANSPORT", { bold: true, size: 16 }],
    ["Batangas/Calamba Japs Transport And General Services Inc.", { bold: true, size: 11 }],
    ["Mapulo, Taysan, Batangas", { size: 11 }],
    ["Teller's Report", { bold: true, size: 14 }],
    [
      new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      }),
      { italic: true, size: 11 },
    ],
  ];
  titles.forEach(([text, font], i) => {
    ws.mergeCells(i + 1, 1, i + 1, 8);
    const c = ws.getCell(i + 1, 1);
    c.value = text;
    c.font = font;
    c.alignment = { horizontal: "left" };
  });

  // Header row (row 7)
  const hr = ws.getRow(7);
  heads.forEach((h, i) => (hr.getCell(i + 1).value = h));
  hr.height = 42;
  hr.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E5AAA" } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  });

  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 20;
  ws.getColumn(3).width = 20;
  for (let i = 4; i < lastCol; i++) ws.getColumn(i).width = 14;
  ws.getColumn(statusCol).width = 12;

  const statusLabel = { submitted: "Pending", approved: "Approved", rejected: "Rejected" };
  const thin = { style: "thin", color: { argb: "FF9CA3AF" } };
  const box = { top: thin, bottom: thin, left: thin, right: thin };

  rows.forEach((r, idx) => {
    const byType = {};
    (r.RemittanceExpenses || []).forEach((e) => {
      byType[e.expense_type] = (byType[e.expense_type] || 0) + num(e.amount);
    });
    // Any expense type not in the fixed list goes into Miscellaneous.
    const known = new Set(EXPENSE_COLUMNS.map((c) => c[0]));
    Object.keys(byType).forEach((k) => {
      if (!known.has(k)) {
        byType.miscellaneous = (byType.miscellaneous || 0) + byType[k];
        delete byType[k];
      }
    });

    const gross = num(r.gross_income);
    const totalExp = num(r.total_expenses);
    const vals = [
      r.BusModel ? r.BusModel.bus_number : "",
      fullName(r.driver),
      fullName(r.conductor),
      gross,
      ...EXPENSE_COLUMNS.map((c) => byType[c[0]] || 0),
      totalExp,
      gross - totalExp,
      Math.round(num(r.driver_commission)),
      Math.round(num(r.conductor_commission)),
      num(r.net_collection),
      num(r.cash_deposit),
      num(r.net_collection) + num(r.cash_deposit),
      r.cash_received == null ? null : num(r.cash_received),
      statusLabel[r.status] || r.status,
    ];
    const row = ws.getRow(FIRST_DATA + idx);
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.border = box;
      if (i >= 3 && i < lastCol - 1) {
        c.numFmt = PESO;
        c.alignment = { horizontal: "right" };
      }
      if (i === lastCol - 1) c.alignment = { horizontal: "center" };
    });
  });

  const lastData = FIRST_DATA + Math.max(rows.length, 1) - 1;
  if (!rows.length) {
    ws.mergeCells(FIRST_DATA, 1, FIRST_DATA, lastCol);
    const c = ws.getCell(FIRST_DATA, 1);
    c.value = "No remittances for this day.";
    c.font = { italic: true, color: { argb: "FF6B7280" } };
    c.alignment = { horizontal: "center" };
  }

  // TOTAL row (approved only)
  const totalRowNo = lastData + 1;
  const tr = ws.getRow(totalRowNo);
  ws.mergeCells(totalRowNo, 1, totalRowNo, 3);
  tr.getCell(1).value = "TOTAL (approved only)";
  tr.getCell(1).alignment = { horizontal: "center" };
  const approvedRows = rows.filter((r) => r.status === "approved");
  for (let i = 4; i < lastCol; i++) {
    const L = colL(i);
    const c = tr.getCell(i);
    if (rows.length) {
      // Cache the computed value so viewers that don't recalculate still show it.
      let result = 0;
      approvedRows.forEach((r) => {
        const idx = rows.indexOf(r);
        const v = ws.getRow(FIRST_DATA + idx).getCell(i).value;
        result += typeof v === "number" ? v : 0;
      });
      c.value = {
        formula: `SUMIF($${colL(statusCol)}$${FIRST_DATA}:$${colL(statusCol)}$${lastData},"Approved",${L}${FIRST_DATA}:${L}${lastData})`,
        result,
      };
    } else {
      c.value = 0;
    }
    c.numFmt = PESO;
    c.alignment = { horizontal: "right" };
  }
  tr.eachCell({ includeEmpty: true }, (c) => {
    c.font = { bold: true };
    c.border = { top: { style: "medium" }, bottom: { style: "double" }, left: thin, right: thin };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FB" } };
  });

  const note = ws.getRow(totalRowNo + 2);
  ws.mergeCells(totalRowNo + 2, 1, totalRowNo + 2, 10);
  note.getCell(1).value =
    "Totals count approved remittances only. Pending and rejected remittances are listed for reference.";
  note.getCell(1).font = { italic: true, color: { argb: "FF6B7280" } };
}

function readRange(req, res) {
  const { from, to } = req.query;
  if (!isDay(from) || !isDay(to) || from > to) {
    res.status(400).json({ message: "Choose a valid date range (from ≤ to)." });
    return null;
  }
  return { from, to };
}

router.get("/reports/summary", async (req, res) => {
  try {
    const range = readRange(req, res);
    if (!range) return;
    const { summary } = await loadReport(range.from, range.to);
    return res.json(summary);
  } catch (error) {
    console.error("Error building report summary:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
});

router.get("/reports/remittances", async (req, res) => {
  try {
    const range = readRange(req, res);
    if (!range) return;
    const ExcelJS = require("exceljs");
    const { rows, approved, summary } = await loadReport(range.from, range.to);

    const PESO = '"₱"#,##0.00';
    const WHOLE = '"₱"#,##0.00'; // commissions are whole pesos, shown with .00
    const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E5AAA" } };
    // Style only the cells that hold a heading (not the whole row).
    const styleHeader = (row, colCount) => {
      for (let i = 1; i <= colCount; i++) {
        const c = row.getCell(i);
        c.font = { bold: true, color: { argb: "FFFFFFFF" } };
        c.fill = HEADER_FILL;
        c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      }
      row.height = 28;
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = "JAPS";
    wb.created = new Date();
    const isDaily = range.from === range.to;
    if (isDaily) buildDailySheet(wb, rows, range.from);

    // ── Sheet 1: Summary ──────────────────────────────────────────────────
    const ws1 = wb.addWorksheet("Summary");
    ws1.columns = [{ width: 44 }, { width: 24 }];
    const GREY = { argb: "FF6B7280" };
    const thin = { style: "thin", color: { argb: "FFD1D5DB" } };

    ws1.mergeCells("A1:B1");
    ws1.getCell("A1").value = "JAPS Remittance Report";
    ws1.getCell("A1").font = { bold: true, size: 16 };
    ws1.mergeCells("A2:B2");
    ws1.getCell("A2").value =
      range.from === range.to
        ? `Date: ${range.from}  ·  Approved remittances only`
        : `Period: ${range.from} to ${range.to}  ·  Approved remittances only`;
    ws1.getCell("A2").font = { italic: true, color: GREY };
    ws1.addRow([]);

    styleHeader(ws1.addRow(["Particulars", "Total"]), 2);

    const section = (title) => {
      const r = ws1.addRow([title]);
      ws1.mergeCells(r.number, 1, r.number, 2);
      r.getCell(1).font = { bold: true, color: { argb: "FF1E5AAA" } };
      r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FB" } };
      r.getCell(1).alignment = { vertical: "middle" };
      r.height = 22;
    };
    const line = (label, value, fmt, opts = {}) => {
      const r = ws1.addRow([label, value]);
      r.getCell(1).alignment = { indent: 1 };
      r.getCell(2).numFmt = fmt;
      r.getCell(2).alignment = { horizontal: "right" };
      r.eachCell((c) => (c.border = { bottom: thin }));
      if (opts.bold) {
        r.font = { bold: true };
        r.eachCell((c) => {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
          c.border = { top: { style: "thin" }, bottom: { style: "double" } };
        });
      }
    };

    section("Remittances");
    line("Approved remittances", summary.remittances, "0");

    section("Income");
    line("Gross income", summary.gross_income, PESO);
    line("Less: total expenses", summary.total_expenses, PESO);
    line("Net gross", summary.net_gross, PESO);

    section("Commissions");
    line("Driver commission", summary.driver_commission, WHOLE);
    line("Conductor commission", summary.conductor_commission, WHOLE);

    section("Collection");
    line("Net collection", summary.net_collection, PESO);
    line("Cash deposit", summary.cash_deposit, PESO);
    line("Total revenue", summary.total_revenue, PESO, { bold: true });

    section("Cash received");
    line("Cash remitted (received by audit teller)", summary.cash_received, PESO);
    line(
      "Difference (cash remitted − total revenue)",
      summary.cash_received - summary.total_revenue,
      PESO,
    );

    ws1.addRow([]);
    const note = ws1.addRow([
      `Not included in the totals: ${summary.pending} pending, ${summary.rejected} rejected.`,
    ]);
    ws1.mergeCells(note.number, 1, note.number, 2);
    note.getCell(1).font = { italic: true, color: GREY };

    if (!isDaily) {
    // ── Sheet 2: Remittances (all statuses) ───────────────────────────────
    const ws2 = wb.addWorksheet("Remittances", { views: [{ state: "frozen", ySplit: 1 }] });
    ws2.columns = [
      { header: "ID", key: "id", width: 8 },
      { header: "Date", key: "date", width: 13 },
      { header: "Status", key: "status", width: 12 },
      { header: "Bus", key: "bus", width: 12 },
      { header: "Conductor", key: "conductor", width: 22 },
      { header: "Driver", key: "driver", width: 22 },
      { header: "Trips", key: "trips", width: 8 },
      { header: "Gross Income", key: "gross", width: 16 },
      { header: "Expenses", key: "exp", width: 14 },
      { header: "Net Gross", key: "netGross", width: 16 },
      { header: "Driver Commission", key: "dc", width: 18 },
      { header: "Conductor Commission", key: "cc", width: 20 },
      { header: "Net Collection", key: "nc", width: 16 },
      { header: "Cash Deposit", key: "cd", width: 15 },
      { header: "Total Revenue", key: "rev", width: 16 },
      { header: "Cash Remitted", key: "cr", width: 16 },
      { header: "Approved By", key: "by", width: 20 },
    ];
    styleHeader(ws2.getRow(1), 17);
    const statusLabel = { submitted: "Pending", approved: "Approved", rejected: "Rejected" };
    for (const r of rows) {
      ws2.addRow({
        id: r.id,
        date: r.date,
        status: statusLabel[r.status] || r.status,
        bus: r.BusModel ? r.BusModel.bus_number : "",
        conductor: fullName(r.conductor),
        driver: fullName(r.driver),
        trips: num(r.no_of_trips),
        gross: num(r.gross_income),
        exp: num(r.total_expenses),
        netGross: num(r.gross_income) - num(r.total_expenses),
        dc: Math.round(num(r.driver_commission)),
        cc: Math.round(num(r.conductor_commission)),
        nc: num(r.net_collection),
        cd: num(r.cash_deposit),
        rev: num(r.net_collection) + num(r.cash_deposit),
        cr: r.cash_received == null ? null : num(r.cash_received),
        by: fullName(r.approver),
      });
    }
    ["gross", "exp", "netGross", "dc", "cc", "nc", "cd", "rev", "cr"].forEach((k) => {
      ws2.getColumn(k).numFmt = PESO;
    });
    ws2.autoFilter = { from: "A1", to: "Q1" };

    // ── Sheet 3: Daily (approved only) ────────────────────────────────────
    const ws3 = wb.addWorksheet("Daily", { views: [{ state: "frozen", ySplit: 1 }] });
    ws3.columns = [
      { header: "Date", key: "date", width: 14 },
      { header: "Remittances", key: "count", width: 14 },
      { header: "Net Collection", key: "nc", width: 18 },
      { header: "Cash Deposit", key: "cd", width: 16 },
      { header: "Total Revenue", key: "rev", width: 18 },
    ];
    styleHeader(ws3.getRow(1), 5);
    const byDay = new Map();
    for (const r of approved) {
      const k = dateKey(r.date);
      const d = byDay.get(k) || { count: 0, nc: 0, cd: 0 };
      d.count += 1;
      d.nc += num(r.net_collection);
      d.cd += num(r.cash_deposit);
      byDay.set(k, d);
    }
    for (const [k, d] of [...byDay.entries()].sort()) {
      ws3.addRow({ date: k, count: d.count, nc: d.nc, cd: d.cd, rev: d.nc + d.cd });
    }
    ["nc", "cd", "rev"].forEach((k) => (ws3.getColumn(k).numFmt = PESO));
    if (byDay.size) {
      const t = ws3.addRow({
        date: "Total",
        count: summary.remittances,
        nc: summary.net_collection,
        cd: summary.cash_deposit,
        rev: summary.total_revenue,
      });
      t.font = { bold: true };
    }

    }

    const fileName = isDaily
      ? `JAPS-Daily-Report_${range.from}.xlsx`
      : `JAPS-Remittance-Report_${range.from}_to_${range.to}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error building remittance report:", error);
    if (!res.headersSent)
      return res.status(500).json({ message: "Internal server error." });
  }
});

module.exports = router;