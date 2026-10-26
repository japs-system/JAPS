const test = require("node:test");
const assert = require("node:assert/strict");
const { trainModel, predictNext } = require("./forecastModel");

// Format a Date using its local calendar components, not toISOString() (which
// serializes in UTC). On hosts east of UTC (e.g. UTC+8), `new Date("YYYY-MM-DDT00:00:00")`
// followed by `.toISOString().split("T")[0]` silently rolls the date back by a day,
// desynchronizing the fixture's "date string" from the day-of-week actually used to
// assign its value. Using local components keeps date strings and their derived
// day-of-week self-consistent regardless of the host's timezone.
function toDateOnlyString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildWeekendDoublingSeries(days) {
  const rows = [];
  const start = new Date("2026-01-05T00:00:00"); // a Monday
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dow = d.getDay();
    const value = dow === 0 || dow === 6 ? 200 : 100;
    rows.push({ date: toDateOnlyString(d), value });
  }
  return rows;
}

test("predicts higher values on weekends than weekdays after training on a weekend-doubling pattern", () => {
  const rows = buildWeekendDoublingSeries(90);
  const model = trainModel(rows);
  const forecast = predictNext(model, rows, 7);

  const isWeekend = (dateStr) => {
    const dow = new Date(`${dateStr}T00:00:00`).getDay();
    return dow === 0 || dow === 6;
  };
  const weekend = forecast.filter((f) => isWeekend(f.date));
  const weekday = forecast.filter((f) => !isWeekend(f.date));
  const avg = (arr) => arr.reduce((s, f) => s + f.predicted, 0) / arr.length;

  assert.ok(
    avg(weekend) > avg(weekday),
    `expected weekend average (${avg(weekend)}) > weekday average (${avg(weekday)})`,
  );
});

test("predictions are never negative and cover the requested number of days", () => {
  const rows = buildWeekendDoublingSeries(90);
  const model = trainModel(rows);
  const forecast = predictNext(model, rows, 7);
  assert.equal(forecast.length, 7);
  for (const f of forecast) {
    assert.ok(f.predicted >= 0);
  }
});

test("forecast dates continue sequentially after the last known date", () => {
  const rows = buildWeekendDoublingSeries(90);
  const model = trainModel(rows);
  const forecast = predictNext(model, rows, 3);
  const lastKnown = new Date(`${rows[rows.length - 1].date}T00:00:00`);
  const expectedFirst = new Date(lastKnown);
  expectedFirst.setDate(expectedFirst.getDate() + 1);
  assert.equal(forecast[0].date, toDateOnlyString(expectedFirst));
});
