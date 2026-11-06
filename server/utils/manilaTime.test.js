const test = require("node:test");
const assert = require("node:assert/strict");
const {
  addCalendarDays,
  assignTripNumbersByManilaDay,
  isValidDateKey,
  manilaDateKey,
  manilaDayBounds,
  parseManilaDateTime,
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
