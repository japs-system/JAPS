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
    // Local calendar-day keys for the selected range (used by date-column queries).
    const rangeFromKey = localKey(rangeStart);
    const rangeToKey = localKey(rangeEnd);
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

    // ── KPI: Bus utilisation — average share of active buses used per day ──
    // Averaged over the days in the range that had at least one trip.
    const totalBuses = await BusModel.count({ where: { status: "active" } });
    const busesInUseToday = await Trip.count({
      distinct: true,
      col: "bus_id",
      where: {
        status: { [Op.in]: ["ongoing", "completed"] },
        departure_time: { [Op.between]: [todayStart, todayEnd] },
      },
    });
    const [busUsage] = await sequelize.query(
      `SELECT COALESCE(AVG(d.buses), 0) AS avg_buses, COUNT(*) AS active_days
       FROM (
         SELECT t.departure_time::date AS day, COUNT(DISTINCT t.bus_id) AS buses
         FROM trips t
         WHERE t.status IN ('ongoing', 'completed')
           AND t.departure_time BETWEEN :start AND :end
         GROUP BY t.departure_time::date
       ) d`,
      {
        replacements: { start: rangeStart, end: rangeEnd },
        type: sequelize.QueryTypes.SELECT,
      },
    );
    const avgBusesInUse = Math.round((Number(busUsage?.avg_buses) || 0) * 10) / 10;
    const busUtilRate =
      totalBuses > 0
        ? Math.min(100, Math.round((avgBusesInUse / totalBuses) * 100))
        : 0;

    // ── KPI: Remittance counts within the selected range (by remittance date) ──
    const [remitCounts] = await sequelize.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status = 'approved') AS approved,
              COUNT(*) FILTER (WHERE status = 'submitted') AS pending,
              COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
       FROM remittances
       WHERE date BETWEEN :from AND :to`,
      {
        replacements: { from: rangeFromKey, to: rangeToKey },
        type: sequelize.QueryTypes.SELECT,
      },
    );
    const remittanceTotal = Number(remitCounts?.total) || 0;
    const remittanceApproved = Number(remitCounts?.approved) || 0;
    const remittancePending = Number(remitCounts?.pending) || 0;
    const remittanceRejected = Number(remitCounts?.rejected) || 0;

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

    // ── Route profitability within the range (approved remittances) ───────
    // Revenue per route = total revenue (net collection + cash deposit) of the
    // APPROVED remittances dated in the range, attributed to the routes of the
    // trips in each remittance. When one remittance covers trips on several
    // routes, its total is split in proportion to each route's trip totals
    // (or its trip count if those totals are all zero).
    const routeProfit = await sequelize.query(
      `WITH trip_share AS (
         SELECT t.remittance_id, t.route_id,
                SUM(t.grand_total) AS route_gross,
                COUNT(t.id) AS trips
         FROM trips t
         JOIN remittances rm ON rm.id = t.remittance_id
         WHERE rm.status = 'approved'
           AND rm.date BETWEEN :from AND :to
           AND t.status <> 'cancelled'
         GROUP BY t.remittance_id, t.route_id
       ),
       remit_totals AS (
         SELECT remittance_id,
                SUM(route_gross) AS gross_all,
                SUM(trips) AS trips_all
         FROM trip_share
         GROUP BY remittance_id
       )
       SELECT ts.route_id, r.origin, r.destination,
              SUM((rm.net_collection + rm.cash_deposit) *
                  CASE WHEN rt.gross_all > 0
                       THEN ts.route_gross / rt.gross_all
                       ELSE ts.trips::numeric / rt.trips_all
                  END) AS revenue,
              SUM(ts.trips) AS trip_count
       FROM trip_share ts
       JOIN remit_totals rt ON rt.remittance_id = ts.remittance_id
       JOIN remittances rm ON rm.id = ts.remittance_id
       JOIN routes r ON r.id = ts.route_id
       GROUP BY ts.route_id, r.origin, r.destination
       ORDER BY revenue DESC`,
      {
        replacements: { from: rangeFromKey, to: rangeToKey },
        type: sequelize.QueryTypes.SELECT,
      },
    );

    // Revenue per stop (where passengers get off) of each route, from ticket
    // fares, for the dropdown. Limited to trips of the same approved remittances.
    const stopRevenue = await sequelize.query(
      `SELECT t.route_id,
              COALESCE(NULLIF(tk.dropping_point, ''), 'Unknown') AS stop,
              SUM(tk.fare) AS revenue,
              SUM(COALESCE(tk.passenger_count, 1)) AS passengers
       FROM tickets tk
       JOIN trips t ON t.id = tk.trip_id
       JOIN remittances rm ON rm.id = t.remittance_id
       WHERE rm.status = 'approved'
         AND rm.date BETWEEN :from AND :to
         AND t.status <> 'cancelled'
       GROUP BY t.route_id, COALESCE(NULLIF(tk.dropping_point, ''), 'Unknown')
       ORDER BY revenue DESC`,
      {
        replacements: { from: rangeFromKey, to: rangeToKey },
        type: sequelize.QueryTypes.SELECT,
      },
    );
    const stopsByRoute = {};
    for (const row of stopRevenue) {
      (stopsByRoute[row.route_id] ||= []).push({
        name: row.stop,
        revenue: Number(row.revenue) || 0,
        passengers: Number(row.passengers) || 0,
      });
    }
    for (const r of routeProfit) r.stops = stopsByRoute[r.route_id] ?? [];

    // ── Peak hour analysis (selected range, Manila time, 4 AM – 9 PM) ─────
    const peakHoursRaw = await sequelize.query(
      `SELECT EXTRACT(HOUR FROM issued_at AT TIME ZONE 'Asia/Manila')::int AS hour,
              SUM(COALESCE(passenger_count, 1)) AS ticket_count
       FROM tickets
       WHERE issued_at BETWEEN :start AND :end
         AND EXTRACT(HOUR FROM issued_at AT TIME ZONE 'Asia/Manila') BETWEEN 4 AND 21
       GROUP BY EXTRACT(HOUR FROM issued_at AT TIME ZONE 'Asia/Manila')::int
       ORDER BY hour ASC`,
      {
        replacements: { start: rangeStart, end: rangeEnd },
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

    // ── Total revenue = cash deposit + net collection (approved remittances) ──
    // Same definition for the selected range and the previous period of equal length.
    const totalRevenueInRange = Number(remitRange?.revenue) || 0;
    const [remitPrev] = await sequelize.query(
      `SELECT COALESCE(SUM(net_collection + cash_deposit), 0) AS revenue
       FROM remittances
       WHERE status = 'approved' AND date BETWEEN :from AND :to`,
      {
        replacements: {
          from: localKey(prevRangeStart),
          to: localKey(prevRangeEnd),
        },
        type: sequelize.QueryTypes.SELECT,
      },
    );
    const totalRevenuePrevRange = Number(remitPrev?.revenue) || 0;
    const revenueGrowth =
      totalRevenuePrevRange > 0
        ? (
            ((totalRevenueInRange - totalRevenuePrevRange) /
              totalRevenuePrevRange) *
            100
          ).toFixed(1)
        : null;

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
      busesInUseToday: avgBusesInUse,
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
        total_revenue_in_range: totalRevenueInRange,
        revenue_growth_pct: revenueGrowth,
        passenger_count_in_range: passengerCountInRange,
        passenger_growth_pct: passengerGrowth,
        bus_utilisation_rate: busUtilRate,
        total_buses: totalBuses,
        buses_in_use_today: busesInUseToday,
        avg_buses_in_use_per_day: avgBusesInUse,
        bus_active_days: Number(busUsage?.active_days) || 0,
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

// DELETE /api/owner/remittances/:id
router.delete("/remittances/:id", async (req, res) => {
  let transaction;
  try {
    transaction = await sequelize.transaction();
    const remittance = await Remittance.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!remittance) {
      await transaction.rollback();
      return res.status(404).json({ message: "Remittance not found." });
    }
    await Trip.update(
      { remittance_id: null },
      { where: { remittance_id: remittance.id }, transaction },
    );
    await RemittanceExpense.destroy({
      where: { remittance_id: remittance.id },
      transaction,
    });
    await remittance.destroy({ transaction });
    await transaction.commit();
    return res.status(204).end();
  } catch (error) {
    if (transaction && !transaction.finished) await transaction.rollback();
    console.error("Error deleting remittance:", error);
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

    // ── 0. Anchor: the last day that actually has data (never after today) ──
    // The 90-day window and the 7-day forecast are built relative to this day,
    // so history that stops before today still produces a meaningful forecast.
    const [lastPax] = await sequelize.query(
      `SELECT to_char(MAX(t.departure_time::date), 'YYYY-MM-DD') AS d
       FROM trips t
       JOIN passenger_counts pc ON pc.trip_id = t.id
       WHERE pc.count > 0 AND t.departure_time <= :now`,
      { replacements: { now }, type: sequelize.QueryTypes.SELECT },
    );
    const [lastRev] = await sequelize.query(
      `SELECT to_char(MAX(date), 'YYYY-MM-DD') AS d
       FROM remittances
       WHERE status = 'approved' AND date <= :today
         AND (net_collection + cash_deposit) > 0`,
      { replacements: { today: localKey(now) }, type: sequelize.QueryTypes.SELECT },
    );
    const anchorKey =
      [lastPax?.d, lastRev?.d].filter(Boolean).sort().pop() ?? localKey(now);
    const anchor = new Date(`${anchorKey}T00:00:00`);
    const anchorEnd = new Date(`${anchorKey}T23:59:59.999`);

    // ── 1. Daily passenger data – 90 days ending on the anchor ────────────
    const ninetyDaysAgo = new Date(anchor);
    ninetyDaysAgo.setDate(anchor.getDate() - 89);
    const dailyRaw = await sequelize.query(
      `SELECT to_char(t.departure_time::date, 'YYYY-MM-DD') AS date, COALESCE(SUM(pc.count),0) AS total
       FROM trips t
       LEFT JOIN passenger_counts pc ON pc.trip_id = t.id
       WHERE t.departure_time >= :since AND t.departure_time <= :until
       GROUP BY t.departure_time::date
       ORDER BY t.departure_time::date ASC`,
      {
        replacements: { since: ninetyDaysAgo, until: anchorEnd },
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
      const d = new Date(anchor);
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
       WHERE status = 'approved' AND date >= :since AND date <= :until
       GROUP BY date
       ORDER BY date ASC`,
      {
        replacements: { since: localKey(ninetyDaysAgo), until: anchorKey },
        type: sequelize.QueryTypes.SELECT,
      },
    );

    const revMap = {};
    for (const r of revenueRaw) revMap[r.date] = Number(r.revenue);
    const revDense = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(anchor);
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
    const predictedPassengersTomorrow = passengerForecast7[0]?.predicted ?? 0;
    const predictedRevenueTomorrow = revenueForecast7[0]?.predicted ?? 0;

    // Growth % relative to the anchor day's actual (today when data is current)
    const todayPassengers = dailyMap[anchorKey] ?? 0;
    const todayRevenue = revMap[anchorKey] ?? 0;
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
    const thirtyDaysAgo = new Date(anchor);
    thirtyDaysAgo.setDate(anchor.getDate() - 30);
    const utilRaw = await sequelize.query(
      `SELECT t.departure_time::date AS date,
              COUNT(DISTINCT t.bus_id)::float / GREATEST(:total,1) * 100 AS util_pct
       FROM trips t
       WHERE t.departure_time >= :since AND t.departure_time <= :until
         AND t.status IN ('ongoing','completed')
       GROUP BY t.departure_time::date
       ORDER BY t.departure_time::date ASC`,
      {
        replacements: {
          since: ninetyDaysAgo,
          until: anchorEnd,
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
         SELECT DATE(issued_at AT TIME ZONE 'Asia/Manila') AS day,
                EXTRACT(HOUR FROM issued_at AT TIME ZONE 'Asia/Manila')::int AS hour,
                SUM(COALESCE(passenger_count, 1)) AS daily_count
         FROM tickets
         WHERE issued_at >= :since
           AND EXTRACT(HOUR FROM issued_at AT TIME ZONE 'Asia/Manila') BETWEEN 4 AND 21
         GROUP BY DATE(issued_at AT TIME ZONE 'Asia/Manila'), EXTRACT(HOUR FROM issued_at AT TIME ZONE 'Asia/Manila')
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
      anchor_date: anchorKey,
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

// Daily report: one row per active bus with its assigned crew and remittance totals.
const EXPENSE_COLUMNS = [
  ["officer", "Officer / Police"],
  ["toll_fees", "Toll Fees"],
  ["parking", "Parking"],
  ["ppa", "PPA"],
  ["washing", "Bus Washing"],
  ["diesel", "Diesel / Fuel"],
  ["caller_grand_terminal", "Caller (Grand Terminal)"],
  ["caller_calamba_terminal", "Caller (Calamba Terminal)"],
  ["miscellaneous", "Miscellaneous"],
];

function buildDailySheet(wb, buses, rows, busesWithTrips) {
  const PESO = '#,##0.00';
  const ws = wb.addWorksheet("Daily Report", {
    views: [{ state: "frozen", ySplit: 2 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const heads = [
    "Bus No.", "Driver", "Conductor", "Collection", "Officer", "Toll Fee",
    "Parking", "Bus Washing", "Diesel", "Remittance",
  ];
  const FIRST_DATA = 3;
  const hr = ws.getRow(2);
  heads.forEach((h, i) => (hr.getCell(i + 1).value = h));
  hr.height = 24;
  hr.eachCell((c) => {
    c.font = { bold: true, size: 11, color: { argb: "FF0070C0" } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  });

  [12, 20, 20, 16, 13, 13, 13, 15, 13, 16].forEach(
    (width, i) => (ws.getColumn(i + 1).width = width),
  );
  const thin = { style: "thin", color: { argb: "FF9CA3AF" } };
  const box = { top: thin, bottom: thin, left: thin, right: thin };
  const expensesByType = ["officer", "toll_fees", "parking", "washing", "diesel"];
  const dailyByBus = new Map();
  rows.forEach((r) => {
    let totals = dailyByBus.get(r.bus_id);
    if (!totals) {
      totals = { collection: 0, remittance: 0, expenses: Object.fromEntries(expensesByType.map((type) => [type, 0])) };
      dailyByBus.set(r.bus_id, totals);
    }
    totals.collection += num(r.net_gross);
    if (r.cash_received !== null && r.cash_received !== undefined) {
      totals.remittance += num(r.cash_received);
    }
    (r.RemittanceExpenses || []).forEach((expense) => {
      if (Object.hasOwn(totals.expenses, expense.expense_type)) {
        totals.expenses[expense.expense_type] += num(expense.amount);
      }
    });
  });

  buses.forEach((bus, idx) => {
    const hasTrip = busesWithTrips.has(bus.id);
    const totals = dailyByBus.get(bus.id) || {
      collection: 0,
      remittance: 0,
      expenses: Object.fromEntries(expensesByType.map((type) => [type, 0])),
    };
    const values = [
      bus.bus_number,
      fullName(bus.assignedDriver),
      fullName(bus.assignedConductor),
      hasTrip ? totals.collection : "-",
      hasTrip ? totals.expenses.officer : "-",
      hasTrip ? totals.expenses.toll_fees : "-",
      hasTrip ? totals.expenses.parking : "-",
      hasTrip ? totals.expenses.washing : "-",
      hasTrip ? totals.expenses.diesel : "-",
      hasTrip ? totals.remittance : "-",
    ];
    const row = ws.getRow(FIRST_DATA + idx);
    values.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.border = box;
      if (i >= 3) {
        c.numFmt = PESO;
        c.alignment = { horizontal: "right" };
      }
    });
  });
}

// ── Daily sheet: one row per day, one column per bus (Gross Income of approved
// remittances), then TOTAL, DAILY EXPENSES, NET COLLECTION, NSE, TOTAL REVENUE.
const dayList = (from, to) => {
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1))
    out.push(d.toISOString().slice(0, 10));
  return out;
};
const BLUE = { argb: "FF0070C0" };
const THIN = { style: "thin" };
const BOX = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const ACCT = '_-* #,##0.00_-;\\-* #,##0.00_-;_-* "-"??_-;_-@_-';

function buildMonthlyDailySheet(wb, approved, from, to) {
  const ws = wb.addWorksheet("Daily", { views: [{ state: "frozen", xSplit: 1, ySplit: 3 }] });
  const days = dayList(from, to);
  const busMap = new Map();
  approved.forEach((r) => {
    if (r.BusModel && !busMap.has(r.BusModel.id)) busMap.set(r.BusModel.id, r.BusModel.bus_number);
  });
  const buses = [...busMap.entries()].sort((a, b) => a[0] - b[0]);
  const nb = buses.length;
  const cTotal = nb + 2, cExp = nb + 3, cNet = nb + 4, cNse = nb + 5, cLeft = nb + 6;
  const L = (n) => ws.getColumn(n).letter;

  const heads = ["DAY", ...buses.map((b) => Number(b[1]) || b[1]), "TOTAL", "DAILY EXPENSES", "NET COLLECTION", "NSE", "TOTAL REVENUE"];
  const hr = ws.getRow(3);
  heads.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: BLUE };
    c.alignment = { horizontal: "center" };
    c.border = BOX;
  });
  ws.getColumn(1).width = 8;
  for (let i = 2; i <= cLeft; i++) ws.getColumn(i).width = i > nb + 1 ? 16 : 12;

  const cell = {}; // `${day}|${busId}` -> gross income
  const exp = {};
  const nc = {};
  const cashDeposit = {};
  approved.forEach((r) => {
    const d = dateKey(r.date);
    const k = `${d}|${r.BusModel ? r.BusModel.id : ""}`;
    cell[k] = (cell[k] || 0) + num(r.gross_income);
    exp[d] = (exp[d] || 0) + num(r.total_expenses);
    nc[d] = (nc[d] || 0) + num(r.net_collection);
    cashDeposit[d] = (cashDeposit[d] || 0) + num(r.cash_deposit);
  });

  const first = 4, last = first + days.length - 1;
  days.forEach((d, i) => {
    const rn = first + i;
    const row = ws.getRow(rn);
    row.getCell(1).value = Number(d.slice(8));
    row.getCell(1).font = { bold: true };
    let tot = 0;
    buses.forEach(([id], j) => {
      const v = cell[`${d}|${id}`] || 0;
      tot += v;
      row.getCell(j + 2).value = v;
    });
    const e = exp[d] || 0;
    row.getCell(cTotal).value = { formula: `SUM(B${rn}:${L(nb + 1)}${rn})`, result: tot };
    row.getCell(cExp).value = e || null;
    // Keep collection figures aligned with the approved remittance totals.
    const n = nc[d] || 0;
    row.getCell(cNet).value = n;
    row.getCell(cLeft).value = n + (cashDeposit[d] || 0);
    for (let c = 1; c <= cLeft; c++) {
      const x = row.getCell(c);
      x.border = BOX;
      x.alignment = { horizontal: "center" };
      if (c > 1) x.numFmt = ACCT;
    }
  });

  const tr = ws.getRow(last + 2);
  tr.getCell(1).value = "Total";
  for (let c = 2; c <= cLeft; c++) {
    if (c === cExp) continue;
    let result = 0;
    for (let r = first; r <= last; r++) {
      const v = ws.getRow(r).getCell(c).value;
      result += v && typeof v === "object" ? v.result : Number(v) || 0;
    }
    tr.getCell(c).value = { formula: `SUM(${L(c)}${first}:${L(c)}${last})`, result };
  }
  tr.getCell(cExp).value = { formula: `SUM(${L(cExp)}${first}:${L(cExp)}${last})`, result: Object.values(exp).reduce((a, b) => a + b, 0) };
  for (let c = 1; c <= cLeft; c++) {
    const x = tr.getCell(c);
    x.font = { bold: true };
    x.border = BOX;
    x.alignment = { horizontal: "center" };
    if (c > 1) x.numFmt = ACCT;
  }
}

// ── Attendance sheet: drivers then conductors, "/" on completed trip days and
// "X" on other days in the selected range. Employee numbers are EMP-### from the user id.
function buildAttendanceSheet(wb, trips, from, to) {
  const ws = wb.addWorksheet("Attendance");
  const days = dayList(from, to);
  ws.getColumn(1).width = 13.9;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 14;
  days.forEach((d, i) => {
    const c = ws.getRow(2).getCell(4 + i);
    c.value = Number(d.slice(8));
    c.alignment = { horizontal: "center" };
    ws.getColumn(4 + i).width = 3.7;
  });
  const emp = { driver: new Map(), conductor: new Map() };
  const manilaDayKey = (value) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  trips.forEach((trip) => {
    ["driver", "conductor"].forEach((role) => {
      const u = trip[role];
      if (!u) return;
      const e = emp[role].get(u.id) || { u, days: new Set() };
      e.days.add(manilaDayKey(trip.departure_time));
      emp[role].set(u.id, e);
    });
  });
  let rn = 3;
  [["DRIVERS", "driver"], ["CONDUCTORS", "conductor"]].forEach(([title, role]) => {
    const h = ws.getRow(rn++);
    h.getCell(1).value = title;
    h.getCell(1).font = { bold: true, color: BLUE };
    [...emp[role].values()]
      .sort((a, b) => String(a.u.last_name).localeCompare(String(b.u.last_name)))
      .forEach((e) => {
        const row = ws.getRow(rn++);
        row.getCell(1).value = `EMP-${String(e.u.id).padStart(3, "0")}`;
        row.getCell(2).value = e.u.first_name;
        row.getCell(3).value = e.u.last_name;
        days.forEach((d, i) => {
          const c = row.getCell(4 + i);
          c.value = e.days.has(d) ? "/" : "X";
          c.border = BOX;
          c.alignment = { horizontal: "center" };
        });
      });
    rn++;
  });
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
    const { rows, approved } = await loadReport(range.from, range.to);

    const wb = new ExcelJS.Workbook();
    wb.creator = "JAPS";
    wb.created = new Date();
    const isDaily = range.from === range.to;
    if (isDaily) {
      const activeBuses = await BusModel.findAll({
        where: { status: "active" },
        include: [
          { model: User, as: "assignedDriver", attributes: ["id", "first_name", "last_name"] },
          { model: User, as: "assignedConductor", attributes: ["id", "first_name", "last_name"] },
        ],
        order: [["bus_number", "ASC"]],
      });
      const completedTrips = await Trip.findAll({
        attributes: ["bus_id"],
        where: {
          status: { [Op.in]: ["scheduled", "ongoing", "completed"] },
          departure_time: {
            [Op.between]: [
              new Date(`${range.from}T00:00:00.000+08:00`),
              new Date(`${range.to}T23:59:59.999+08:00`),
            ],
          },
        },
      });
      buildDailySheet(
        wb,
        activeBuses,
        rows,
        new Set(completedTrips.map((trip) => Number(trip.bus_id))),
      );
    }

    if (!isDaily) {
      buildMonthlyDailySheet(wb, approved, range.from, range.to);
      const attendanceTrips = await Trip.findAll({
        attributes: ["departure_time"],
        where: {
          status: "completed",
          departure_time: {
            [Op.between]: [
              new Date(`${range.from}T00:00:00.000+08:00`),
              new Date(`${range.to}T23:59:59.999+08:00`),
            ],
          },
        },
        include: [
          { model: User, as: "driver", attributes: ["id", "first_name", "last_name"] },
          { model: User, as: "conductor", attributes: ["id", "first_name", "last_name"] },
        ],
      });
      buildAttendanceSheet(wb, attendanceTrips, range.from, range.to);
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