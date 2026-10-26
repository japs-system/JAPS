const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isReadyForML,
  MIN_DAYS_FOR_ML,
} = require("./dataReadinessCheck");

function makeRows(activeCount, totalCount) {
  const rows = [];
  for (let i = 0; i < totalCount; i++) {
    rows.push({
      date: `2026-${String((Math.floor(i / 28) % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      value: i < activeCount ? 1 : 0,
    });
  }
  return rows;
}

test("not ready when active days are below the threshold", () => {
  const result = isReadyForML(makeRows(MIN_DAYS_FOR_ML - 1, 90));
  assert.equal(result.ready, false);
});

test("ready when active days meet the threshold exactly", () => {
  const result = isReadyForML(makeRows(MIN_DAYS_FOR_ML, 90));
  assert.equal(result.ready, true);
});

test("ready when active days exceed the threshold", () => {
  const result = isReadyForML(makeRows(90, 90));
  assert.equal(result.ready, true);
});

test("reason string reflects the active day count", () => {
  const result = isReadyForML(makeRows(10, 90));
  assert.match(result.reason, /10/);
});

test("counts rows, not distinct dates — callers must pre-aggregate by date", () => {
  const duplicateDateRows = Array.from({ length: MIN_DAYS_FOR_ML }, () => ({
    date: "2026-01-01",
    value: 1,
  }));
  const result = isReadyForML(duplicateDateRows);
  assert.equal(
    result.ready,
    true,
    "documents that duplicate-date rows are counted individually, not deduplicated",
  );
});
