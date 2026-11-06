
// Converts dashboard metrics into short, easy-to-understand insights.
// Rule-based only: each rule returns at most one insight.
// Order of the returned list determines display order.

const peso = (n) =>
  `₱${Number(n).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;

const pct = (n) => `${Math.abs(n).toFixed(1)}%`;

const hourLabel = (h) => {
  const hour = Number(h);
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 || 12} ${suffix}`;
};

// Changes below 2% are considered steady.
const STEADY_BAND = 2;

// 1. Passenger trend
const passengerTrend = ({
  passengersInRange,
  passengersPrevRange,
  passengerGrowthPct,
}) => {
  if (passengerGrowthPct == null || !(passengersPrevRange > 0)) {
    return null;
  }

  const change = Number(passengerGrowthPct);
  const current = Number(passengersInRange) || 0;

  if (Math.abs(change) < STEADY_BAND) {
    return {
      tone: "neutral",
      title: "Passenger count is steady",
      message: `${current.toLocaleString()} passengers this period, about the same as before.`,
    };
  }

  const up = change > 0;

  return {
    tone: up ? "positive" : "negative",
    title: up ? "More passengers this period" : "Fewer passengers this period",
    message: `${current.toLocaleString()} passengers, ${pct(change)} ${up ? "more" : "fewer"} than the previous period.`,
  };
};

// 2. Revenue trend
const revenueTrend = ({ netGrossInRange, netGrossPrevRange }) => {
  const current = Number(netGrossInRange) || 0;
  const previous = Number(netGrossPrevRange) || 0;

  if (!(previous > 0) || !(current > 0)) return null;

  const change = ((current - previous) / previous) * 100;

  if (Math.abs(change) < STEADY_BAND) {
    return {
      tone: "neutral",
      title: "Revenue stayed about the same",
      message: `Approved net revenue is ${peso(current)}.`,
    };
  }

  const up = change > 0;

  return {
    tone: up ? "positive" : "negative",
    title: up ? "Revenue went up" : "Revenue went down",
    message: `${peso(current)} in approved net revenue, ${pct(change)} ${up ? "higher" : "lower"} than before.`,
  };
};

// 3. Trip performance
const tripPerformance = ({ tripsCompleted, tripsCancelled }) => {
  const completed = Number(tripsCompleted) || 0;
  const cancelled = Number(tripsCancelled) || 0;

  if (completed + cancelled === 0) return null;

  const cancelRate = (cancelled / (completed + cancelled)) * 100;

  const parts = [
    `${completed} completed`,
    `${cancelled} cancelled`,
  ];

  if (cancelRate >= 10) {
    return {
      tone: "warning",
      title: "Many trips were cancelled",
      message: `${parts.join(", ")} this period. Review trip schedules and possible causes.`,
    };
  }

  return {
    tone: "positive",
    title: "Trip summary",
    message: `${parts.join(", ")} this period.`,
  };
};

const departureDelays = ({ avgDepartureDelayMin, tripsWithActualDeparture }) => {
  const recorded = Number(tripsWithActualDeparture) || 0;
  const averageDelay = Number(avgDepartureDelayMin);
  if (recorded === 0 || !Number.isFinite(averageDelay) || averageDelay < 15) return null;

  return {
    tone: "warning",
    title: "Departures are running late",
    message: `Trips with recorded departures are leaving an average of ${Math.round(averageDelay)} minutes late.`,
  };
};

// 4. Top-earning route
const topRoute = ({ routeProfit }) => {
  const routes = (routeProfit ?? []).filter(
    (r) => Number(r.revenue) > 0
  );

  if (routes.length === 0) return null;

  const best = routes[0];

  const message =
    routes.length > 1
      ? `${best.origin} → ${best.destination} earned ${peso(best.revenue)} from ${best.trip_count} trips.`
      : `${best.origin} → ${best.destination} earned ${peso(best.revenue)} from ${best.trip_count} completed trips.`;

  return {
    tone: "neutral",
    title: "Top-earning route",
    message,
  };
};

// 5. Busiest boarding hour
const peakHour = ({ peakHours }) => {
  const hours = (peakHours ?? []).filter(
    (h) => Number(h.ticket_count) > 0
  );

  if (hours.length < 3) return null;

  const busiest = hours.reduce((a, b) =>
    Number(b.ticket_count) > Number(a.ticket_count) ? b : a
  );

  return {
    tone: "neutral",
    title: "Busiest boarding time",
    message: `Most passengers board around ${hourLabel(busiest.hour)}. Make sure enough buses are available.`,
  };
};

// 6. Weekday vs. weekend passenger count
const weekdayVsWeekend = ({ weekdayWeekend }) => {
  const rows = weekdayWeekend ?? [];

  let weekday = 0;
  let weekend = 0;

  for (const r of rows) {
    const dow = Number(r.dow);

    if (dow === 0 || dow === 6) {
      weekend += Number(r.total);
    } else {
      weekday += Number(r.total);
    }
  }

  if (weekday === 0 || weekend === 0) return null;

  // Average per day: 5 weekdays vs. 2 weekend days.
  const weekdayAvg = weekday / 5;
  const weekendAvg = weekend / 2;

  const diff = ((weekendAvg - weekdayAvg) / weekdayAvg) * 100;

  if (Math.abs(diff) < 10) {
    return {
      tone: "neutral",
      title: "Passenger numbers are similar",
      message: "Passenger demand is almost the same on weekdays and weekends.",
    };
  }

  const busierWeekend = diff > 0;

  return {
    tone: "neutral",
    title: busierWeekend
      ? "Weekends are busier"
      : "Weekdays are busier",
    message: `${busierWeekend ? "Weekends" : "Weekdays"} have ${pct(diff)} more passengers per day.`,
  };
};

// 7. Fleet utilisation
const fleetUtilisation = ({
  busUtilisationRate,
  totalBuses,
  busesInUseToday,
}) => {
  if (!(totalBuses > 0)) return null;

  const rate = Number(busUtilisationRate) || 0;

  if (rate >= 80) {
    return {
      tone: "positive",
      title: "Most buses are in use",
      message: `${busesInUseToday} of ${totalBuses} active buses operate on an average day (${rate}%).`,
    };
  }

  if (rate < 50) {
    return {
      tone: "warning",
      title: "Some buses are idle",
      message: `Only ${busesInUseToday} of ${totalBuses} active buses operate on an average day (${rate}%). Review schedules and crew assignments.`,
    };
  }

  return null;
};

// 8. Pending remittances
const pendingRemittances = ({ remittancePending }) => {
  const pending = Number(remittancePending) || 0;

  if (pending === 0) return null;

  return {
    tone: "warning",
    title: "Remittances need approval",
    message: `${pending} remittance${pending === 1 ? " is" : "s are"} waiting for audit-teller review.`,
  };
};

// Insight display order
const RULES = [
  passengerTrend,
  revenueTrend,
  tripPerformance,
  departureDelays,
  topRoute,
  peakHour,
  weekdayVsWeekend,
  fleetUtilisation,
  pendingRemittances,
];

/**
 * @param {object} metrics Dashboard figures.
 * @returns {{ tone: 'positive'|'negative'|'neutral'|'warning', title: string, message: string }[]}
 */
const buildInsights = (metrics) =>
  RULES.map((rule) => rule(metrics)).filter(Boolean);

module.exports = { buildInsights };
