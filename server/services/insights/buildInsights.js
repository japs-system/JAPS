// Turns the owner dashboard's numbers into plain-language observations for the
// "Insights" panel. Pure and rule-based (no ML): every rule reads the metrics it needs,
// skips itself when that data is missing or too thin to say anything meaningful, and
// returns at most one insight. Order of the returned list = display order.

const peso = (n) =>
  `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const pct = (n) => `${Math.abs(n).toFixed(1)}%`;

const hourLabel = (h) => {
  const hour = Number(h);
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 || 12} ${suffix}`;
};

// Changes smaller than this (in %) are reported as "steady" rather than up/down.
const STEADY_BAND = 2;

const passengerTrend = ({ passengersInRange, passengersPrevRange, passengerGrowthPct }) => {
  if (passengerGrowthPct == null || !(passengersPrevRange > 0)) return null;
  const change = Number(passengerGrowthPct);
  if (Math.abs(change) < STEADY_BAND) {
    return {
      tone: "neutral",
      title: "Ridership is steady",
      message: `${passengersInRange.toLocaleString()} passengers this period — about the same as the previous period.`,
    };
  }
  const up = change > 0;
  return {
    tone: up ? "positive" : "negative",
    title: up ? "Ridership is up" : "Ridership is down",
    message: `${passengersInRange.toLocaleString()} passengers this period, ${pct(change)} ${up ? "more" : "fewer"} than the previous period (${passengersPrevRange.toLocaleString()}).`,
  };
};

const revenueTrend = ({ netGrossInRange, netGrossPrevRange }) => {
  const current = Number(netGrossInRange) || 0;
  const previous = Number(netGrossPrevRange) || 0;
  if (!(previous > 0) || !(current > 0)) return null;
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < STEADY_BAND) {
    return {
      tone: "neutral",
      title: "Revenue is holding steady",
      message: `Approved net gross is ${peso(current)}, in line with the previous period.`,
    };
  }
  const up = change > 0;
  return {
    tone: up ? "positive" : "negative",
    title: up ? "Revenue increased" : "Revenue decreased",
    message: `Approved net gross is ${peso(current)}, ${pct(change)} ${up ? "higher" : "lower"} than the previous period (${peso(previous)}).`,
  };
};

const topRoute = ({ routeProfit }) => {
  const routes = (routeProfit ?? []).filter((r) => Number(r.revenue) > 0);
  if (routes.length === 0) return null;
  const total = routes.reduce((sum, r) => sum + Number(r.revenue), 0);
  const best = routes[0];
  const share = (Number(best.revenue) / total) * 100;
  const message =
    routes.length > 1
      ? `${best.origin} → ${best.destination} earns the most: ${peso(best.revenue)} over ${best.trip_count} trips (${share.toFixed(0)}% of revenue from the top routes).`
      : `${best.origin} → ${best.destination} has earned ${peso(best.revenue)} over ${best.trip_count} completed trips.`;
  return { tone: "neutral", title: "Top-earning route", message };
};

const peakHour = ({ peakHours }) => {
  const hours = (peakHours ?? []).filter((h) => Number(h.ticket_count) > 0);
  if (hours.length < 3) return null;
  const busiest = hours.reduce((a, b) => (Number(b.ticket_count) > Number(a.ticket_count) ? b : a));
  return {
    tone: "neutral",
    title: "Busiest boarding hour",
    message: `Most passengers board around ${hourLabel(busiest.hour)} (last 30 days). Make sure buses are on the road for that window.`,
  };
};

const weekdayVsWeekend = ({ weekdayWeekend }) => {
  const rows = weekdayWeekend ?? [];
  let weekday = 0;
  let weekend = 0;
  for (const r of rows) {
    const dow = Number(r.dow);
    if (dow === 0 || dow === 6) weekend += Number(r.total);
    else weekday += Number(r.total);
  }
  if (weekday === 0 || weekend === 0) return null;
  // Average per day type: 5 weekdays vs 2 weekend days a week.
  const weekdayAvg = weekday / 5;
  const weekendAvg = weekend / 2;
  const diff = ((weekendAvg - weekdayAvg) / weekdayAvg) * 100;
  if (Math.abs(diff) < 10) {
    return {
      tone: "neutral",
      title: "Even demand across the week",
      message: "Weekend and weekday ridership are about the same per day (last 12 weeks).",
    };
  }
  const busierWeekend = diff > 0;
  return {
    tone: "neutral",
    title: busierWeekend ? "Weekends are busier" : "Weekdays are busier",
    message: `${busierWeekend ? "Weekend" : "Weekday"} days average ${pct(diff)} more passengers than ${busierWeekend ? "weekdays" : "weekend days"} (last 12 weeks).`,
  };
};

const fleetUtilisation = ({ busUtilisationRate, totalBuses, busesInUseToday }) => {
  if (!(totalBuses > 0)) return null;
  const rate = Number(busUtilisationRate) || 0;
  if (rate >= 80) {
    return {
      tone: "positive",
      title: "Fleet is well used today",
      message: `${busesInUseToday} of ${totalBuses} active buses have run trips today (${rate}%).`,
    };
  }
  if (rate < 50) {
    return {
      tone: "warning",
      title: "Buses sitting idle today",
      message: `Only ${busesInUseToday} of ${totalBuses} active buses have run trips today (${rate}%). Check schedules and crew assignments.`,
    };
  }
  return null;
};

const tripPerformance = ({ tripsCompleted, tripsCancelled, avgDepartureDelayMin, tripsWithActualDeparture }) => {
  const completed = Number(tripsCompleted) || 0;
  const cancelled = Number(tripsCancelled) || 0;
  if (completed + cancelled === 0) return null;

  const parts = [`${completed} trip${completed === 1 ? "" : "s"} completed`];
  if (cancelled > 0) parts.push(`${cancelled} cancelled`);
  const cancelRate = (cancelled / (completed + cancelled)) * 100;

  let tone = "positive";
  let title = "Trips running to plan";
  if (avgDepartureDelayMin != null && Number(tripsWithActualDeparture) > 0) {
    const delay = Math.round(Number(avgDepartureDelayMin));
    if (delay > 10) {
      tone = "warning";
      title = "Departures are running late";
    }
    parts.push(`average departure ${delay} min after schedule`);
  }
  if (cancelRate >= 10) {
    tone = "warning";
    title = "High cancellation rate";
  }
  return { tone, title, message: `${parts.join(", ")} this period.` };
};

const pendingRemittances = ({ remittancePending }) => {
  const pending = Number(remittancePending) || 0;
  if (pending === 0) return null;
  return {
    tone: "warning",
    title: "Remittances awaiting review",
    message: `${pending} remittance${pending === 1 ? " is" : "s are"} still waiting for audit-teller approval.`,
  };
};

const RULES = [
  passengerTrend,
  revenueTrend,
  tripPerformance,
  topRoute,
  peakHour,
  weekdayVsWeekend,
  fleetUtilisation,
  pendingRemittances,
];

/**
 * @param {object} metrics dashboard figures (see the rule functions for field names)
 * @returns {{ tone: 'positive'|'negative'|'neutral'|'warning', title: string, message: string }[]}
 */
const buildInsights = (metrics) => RULES.map((rule) => rule(metrics)).filter(Boolean);

module.exports = { buildInsights };
