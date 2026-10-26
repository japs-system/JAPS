const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDailyForecast, buildUtilForecast } = require("./buildForecast");

// Formats a Date using its LOCAL calendar fields, never toISOString() (which
// serializes in UTC). Parsing a date-only string as local midnight and then
// round-tripping through toISOString() silently shifts the date by one day
// on any host east of UTC — see Task 5's report for the bug this avoids.
function toDateOnlyString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function makeSparseRows(days) {
  // Fewer than the 60-day ML threshold, mostly zero — should force fallback.
  const rows = [];
  for (let i = 0; i < days; i++) {
    const d = new Date("2026-01-01T00:00:00");
    d.setDate(d.getDate() + i);
    rows.push({ date: toDateOnlyString(d), value: i < 10 ? 5 : 0 });
  }
  return rows;
}

function makeRichWeekendRows(days) {
  const rows = [];
  for (let i = 0; i < days; i++) {
    const d = new Date("2026-01-01T00:00:00");
    d.setDate(d.getDate() + i);
    const dow = d.getDay();
    rows.push({
      date: toDateOnlyString(d),
      value: dow === 0 || dow === 6 ? 200 : 100,
    });
  }
  return rows;
}

test("buildDailyForecast seasonal blend formula matches hand-computed value", () => {
  // Reuse makeRichWeekendRows, but with only 20 days: activeDays === 20 <
  // MIN_DAYS_FOR_ML (60), so isReadyForML deterministically forces the
  // statistical path (unlike the 90-day version of this fixture used above,
  // which is rich enough to go ML). The weekday/weekend split (100 / 200)
  // repeats exactly on a 7-day period across all 20 rows, which makes both
  // linearRegression and computeSeasonalFactors work out to clean numbers:
  //
  //   - linearRegression on points {x:i, y:value} (useSeasonalBlend skips
  //     de-seasonalizing, using raw values as points): the periodic pattern
  //     is symmetric enough over 20 points that slope === 0 exactly, and
  //     intercept === mean(values) === 130. So trendVal = 130 for every
  //     forecasted day (predict(x) = 130 regardless of x).
  //   - computeSeasonalFactors: Sun/Sat dowAvg = 200, Mon-Fri dowAvg = 100,
  //     globalAvg = (200+100*5+200)/7 = 900/7 ≈ 128.571. So
  //     factor(weekday) = 100/128.571 = 0.777... (7/9) and
  //     factor(weekend) = 200/128.571 = 1.555... (14/9).
  //
  // rows[19] is 2026-01-20 (Tue); the 5 forecasted days (2026-01-21..25)
  // are Wed, Thu, Fri, Sat, Sun — i.e. 3 weekdays then 2 weekend days.
  //
  // Hand calculation (formula under test:
  // predicted = round(trendVal * (0.7 + 0.3 * seasonalFactors[dow]))):
  //   weekday: round(130 * (0.7 + 0.3 * 7/9))  = round(130 * 0.93333..) = round(121.33) = 121
  //   weekend: round(130 * (0.7 + 0.3 * 14/9)) = round(130 * 1.16667)  = round(151.67) = 152
  //
  // These values were cross-checked independently via linearRegression()/
  // computeSeasonalFactors() (the same lower-level, separately-tested
  // building blocks buildForecast.js calls) applied to this exact fixture,
  // outside of buildDailyForecast itself.
  //
  // This fixture (unlike an all-equal-value fixture, where every seasonal
  // factor trivially equals 1.0 and the 0.7/0.3 blend collapses to 1.0
  // regardless of the constants) actually distinguishes the correct
  // constants from a swapped 0.3/0.7: swapping would give
  // round(130*(0.3+0.7*7/9)) = 110 and round(130*(0.3+0.7*14/9)) = 181,
  // both different from the expected 121/152 below.
  const result = buildDailyForecast(makeRichWeekendRows(20), {
    daysAhead: 5,
    useSeasonalBlend: true,
  });
  assert.equal(result.method, "statistical");
  assert.equal(result.predictions.length, 5);
  const [wed, thu, fri, sat, sun] = result.predictions;
  assert.equal(wed.predicted, 121);
  assert.equal(thu.predicted, 121);
  assert.equal(fri.predicted, 121);
  assert.equal(sat.predicted, 152);
  assert.equal(sun.predicted, 152);
});

test("buildDailyForecast falls back to statistical method with insufficient data", () => {
  const result = buildDailyForecast(makeSparseRows(90), { daysAhead: 7 });
  assert.equal(result.method, "statistical");
  assert.equal(result.predictions.length, 7);
  assert.equal(result.seasonalFactors.length, 7);
});

test("buildDailyForecast uses ML with sufficient data", () => {
  const result = buildDailyForecast(makeRichWeekendRows(90), { daysAhead: 7 });
  assert.equal(result.method, "ml");
  assert.equal(result.predictions.length, 7);
  assert.equal(result.seasonalFactors.length, 7);
});

test("buildDailyForecast statistical predictions are never negative", () => {
  const result = buildDailyForecast(makeSparseRows(90), { daysAhead: 7 });
  for (const p of result.predictions) {
    assert.ok(p.predicted >= 0);
  }
});

test("buildUtilForecast falls back to statistical method with insufficient data", () => {
  const result = buildUtilForecast(makeSparseRows(30));
  assert.equal(result.method, "statistical");
  assert.ok(result.predictedTomorrow >= 0 && result.predictedTomorrow <= 100);
});

test("buildUtilForecast uses ML with sufficient data", () => {
  const result = buildUtilForecast(makeRichWeekendRows(90));
  assert.equal(result.method, "ml");
  assert.ok(result.predictedTomorrow >= 0 && result.predictedTomorrow <= 100);
});
