const test = require("node:test");
const assert = require("node:assert/strict");
const { isHoliday } = require("./holidays");

test("recognizes a fixed-date holiday", () => {
  assert.equal(isHoliday("2026-12-25"), true);
});

test("recognizes a movable holiday from the lookup table", () => {
  assert.equal(isHoliday("2026-02-17"), true);
});

test("returns false for an ordinary day", () => {
  assert.equal(isHoliday("2026-03-10"), false);
});
