const test = require("node:test");
const assert = require("node:assert/strict");
const {
  addCalendarDays,
  assignTripNumbersByManilaDay,
  isValidDateKey,
  manilaDateKey,
  manilaDayBounds,
  parseManilaDateTime,
  scheduleDepartureError,
} = require("./manilaTime");

test("parses local schedule inputs as Manila time regardless of process timezone", () => {
  assert.equal(parseManilaDateTime("2026-11-07T06:30").toISOString(), "2026-11-06T22:30:00.000Z");
});

test("uses half-open Manila calendar-day boundaries", () => {
  const { start, endExclusive } = manilaDayBounds("2026-11-07");
  assert.equal(start.toISOString(), "2026-11-06T16:00:00.000Z");
  assert.equal(endExclusive.toISOString(), "2026-11-07T16:00:00.000Z");
  assert.equal(manilaDateKey(start), "2026-11-07");
  assert.equal(manilaDateKey(new Date(endExclusive.getTime() - 1)), "2026-11-07");
  assert.equal(manilaDateKey(endExclusive), "2026-11-08");
});

test("validates and increments calendar dates across month and year boundaries", () => {
  assert.equal(isValidDateKey("2026-02-29"), false);
  assert.equal(isValidDateKey("2028-02-29"), true);
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
});

test("assigns trip numbers independently for trips on either side of Manila midnight", () => {
  const trips = [
    { departureDate: parseManilaDateTime("2026-11-07T23:30") },
    { departureDate: parseManilaDateTime("2026-11-08T00:30") },
    { departureDate: parseManilaDateTime("2026-11-08T01:30") },
  ];
  const numbered = assignTripNumbersByManilaDay(
    trips,
    new Map([
      ["2026-11-07", 4],
      ["2026-11-08", 1],
    ]),
  );
  assert.deepEqual(numbered.map((trip) => trip.trip_number), [4, 1, 2]);
});

test("allows today and future schedule dates through the next five-year milestone", () => {
  const nowIn2026 = new Date("2026-01-01T00:00:00+08:00");
  assert.equal(
    scheduleDepartureError("2025-12-31T23:59", nowIn2026),
    "Trips cannot be scheduled before today.",
  );
  assert.equal(scheduleDepartureError("2026-01-01T00:00", nowIn2026), null);
  assert.equal(scheduleDepartureError("2030-12-31T23:59", nowIn2026), null);
  assert.equal(
    scheduleDepartureError("2031-01-01T00:00", nowIn2026),
    "Trips can only be scheduled through 2030-12-31.",
  );

  const now = new Date("2030-01-01T00:00:00+08:00");

  assert.equal(scheduleDepartureError("2029-12-31T23:59", now), "Trips cannot be scheduled before today.");
  assert.equal(scheduleDepartureError("2030-01-01T00:01", now), null);
  assert.equal(scheduleDepartureError("2035-12-31T23:59", now), null);
  assert.equal(
    scheduleDepartureError("2036-01-01T00:00", now),
    "Trips can only be scheduled through 2035-12-31.",
  );
});
