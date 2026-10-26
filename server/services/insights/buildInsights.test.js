const test = require("node:test");
const assert = require("node:assert/strict");
const { buildInsights } = require("./buildInsights");

const byTitle = (insights, title) => insights.find((i) => i.title === title);

test("returns no insights when there is no data", () => {
  assert.deepEqual(buildInsights({}), []);
});

test("reports ridership growth against the previous period", () => {
  const insights = buildInsights({
    passengersInRange: 1200,
    passengersPrevRange: 1000,
    passengerGrowthPct: "20.0",
  });
  const i = byTitle(insights, "Ridership is up");
  assert.ok(i);
  assert.equal(i.tone, "positive");
  assert.match(i.message, /20\.0% more/);
});

test("treats small changes as steady and skips when there is no baseline", () => {
  assert.ok(
    byTitle(
      buildInsights({ passengersInRange: 1010, passengersPrevRange: 1000, passengerGrowthPct: "1.0" }),
      "Ridership is steady",
    ),
  );
  assert.deepEqual(
    buildInsights({ passengersInRange: 50, passengersPrevRange: 0, passengerGrowthPct: null }),
    [],
  );
});

test("reports revenue decline", () => {
  const i = byTitle(
    buildInsights({ netGrossInRange: 8000, netGrossPrevRange: 10000 }),
    "Revenue decreased",
  );
  assert.ok(i);
  assert.equal(i.tone, "negative");
  assert.match(i.message, /20\.0% lower/);
});

test("names the top route and the busiest hour", () => {
  const insights = buildInsights({
    routeProfit: [
      { origin: "Calamba", destination: "Grand Terminal", revenue: "6000", trip_count: "12" },
      { origin: "Grand Terminal", destination: "Calamba", revenue: "4000", trip_count: "10" },
    ],
    peakHours: [
      { hour: 6, ticket_count: "40" },
      { hour: 7, ticket_count: "90" },
      { hour: 17, ticket_count: "60" },
    ],
  });
  assert.match(byTitle(insights, "Top-earning route").message, /Calamba → Grand Terminal.*60%/);
  assert.match(byTitle(insights, "Busiest boarding hour").message, /7 AM/);
});

test("flags late departures and high cancellations", () => {
  const late = byTitle(
    buildInsights({ tripsCompleted: 20, tripsCancelled: 0, avgDepartureDelayMin: 18, tripsWithActualDeparture: 20 }),
    "Departures are running late",
  );
  assert.ok(late);
  assert.equal(late.tone, "warning");

  assert.ok(
    byTitle(buildInsights({ tripsCompleted: 8, tripsCancelled: 2 }), "High cancellation rate"),
  );
});

test("flags idle buses and pending remittances", () => {
  const insights = buildInsights({
    busUtilisationRate: 25,
    totalBuses: 8,
    busesInUseToday: 2,
    remittancePending: 3,
  });
  assert.ok(byTitle(insights, "Buses sitting idle today"));
  assert.match(byTitle(insights, "Remittances awaiting review").message, /3 remittances are/);
});

test("compares weekend and weekday demand per day", () => {
  // 500 over 5 weekdays = 100/day; 400 over 2 weekend days = 200/day.
  const rows = [
    { dow: 1, total: "100" },
    { dow: 2, total: "100" },
    { dow: 3, total: "100" },
    { dow: 4, total: "100" },
    { dow: 5, total: "100" },
    { dow: 6, total: "200" },
    { dow: 0, total: "200" },
  ];
  assert.ok(byTitle(buildInsights({ weekdayWeekend: rows }), "Weekends are busier"));
});
