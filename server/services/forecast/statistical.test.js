const test = require("node:test");
const assert = require("node:assert/strict");
const {
  linearRegression,
  expSmooth,
  computeSeasonalFactors,
} = require("./statistical");

test("linearRegression fits an exact line through collinear points", () => {
  const points = [
    { x: 0, y: 1 },
    { x: 1, y: 3 },
    { x: 2, y: 5 },
  ];
  const lr = linearRegression(points);
  assert.ok(Math.abs(lr.slope - 2) < 1e-9);
  assert.ok(Math.abs(lr.intercept - 1) < 1e-9);
  assert.ok(Math.abs(lr.predict(3) - 7) < 1e-9);
});

test("linearRegression handles a single point without throwing", () => {
  const lr = linearRegression([{ x: 0, y: 5 }]);
  assert.equal(lr.predict(10), 5);
});

test("expSmooth returns the first value unchanged and smooths the rest", () => {
  const result = expSmooth([10, 20, 10], 0.5);
  assert.equal(result[0], 10);
  assert.equal(result[1], 15);
  assert.equal(result[2], 12.5);
});

test("computeSeasonalFactors averages to 1 across the week", () => {
  // 2026-01-04 is a Sunday; build one row per day of a full week.
  const rows = [0, 1, 2, 3, 4, 5, 6].map((offset) => {
    const d = new Date("2026-01-04T00:00:00");
    d.setDate(d.getDate() + offset);
    const dow = d.getDay();
    return {
      date: d.toISOString().split("T")[0],
      value: dow === 0 || dow === 6 ? 100 : 50,
    };
  });
  const factors = computeSeasonalFactors(rows);
  const avg = factors.reduce((s, f) => s + f, 0) / 7;
  assert.ok(Math.abs(avg - 1) < 1e-9);
  assert.equal(factors.length, 7);
});
