const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDailyFeatures,
  toVector,
  FEATURE_ORDER,
} = require("./featureBuilder");

function makeRows(values) {
  return values.map((value, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    value,
  }));
}

test("computes lag_1 and lag_7 from prior rows", () => {
  const rows = makeRows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const features = buildDailyFeatures(rows);
  assert.equal(features[9].features.lag_1, 9);
  assert.equal(features[9].features.lag_7, 3);
});

test("falls back to the row's own value for lag when there is no history", () => {
  const rows = makeRows([42]);
  const features = buildDailyFeatures(rows);
  assert.equal(features[0].features.lag_1, 42);
  assert.equal(features[0].features.lag_7, 42);
});

test("rolling_avg_7 averages at most the trailing 7 values", () => {
  const rows = makeRows([1, 2, 3, 4, 5, 6, 7, 8]);
  const features = buildDailyFeatures(rows);
  // index 7 (8th day): average of days 2..8 = (2+3+4+5+6+7+8)/7 = 5
  assert.equal(features[7].features.rolling_avg_7, 5);
});

test("marks a known holiday date", () => {
  const rows = [{ date: "2026-12-25", value: 10 }];
  const features = buildDailyFeatures(rows);
  assert.equal(features[0].features.is_holiday, 1);
});

test("carries the row's date and label through", () => {
  const rows = [{ date: "2026-01-01", value: 7 }];
  const features = buildDailyFeatures(rows);
  assert.equal(features[0].date, "2026-01-01");
  assert.equal(features[0].y, 7);
});

test("toVector orders values per FEATURE_ORDER", () => {
  const features = {
    day_of_week: 1,
    day_of_month: 2,
    month: 3,
    is_holiday: 0,
    lag_1: 5,
    lag_7: 6,
    rolling_avg_7: 7,
  };
  assert.deepEqual(toVector(features), [1, 2, 3, 0, 5, 6, 7]);
  assert.equal(FEATURE_ORDER.length, 7);
});
