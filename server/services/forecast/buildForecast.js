const { isReadyForML } = require("./dataReadinessCheck");
const { trainModel, predictNext } = require("./forecastModel");
const {
  linearRegression,
  expSmooth,
  computeSeasonalFactors,
} = require("./statistical");

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

function buildDailyForecast(rows, { daysAhead = 7, useSeasonalBlend = false } = {}) {
  if (rows.length === 0) {
    return { method: "statistical", predictions: [], seasonalFactors: computeSeasonalFactors(rows) };
  }

  const seasonalFactors = computeSeasonalFactors(rows);
  const readiness = isReadyForML(rows);

  if (readiness.ready) {
    try {
      const model = trainModel(rows);
      const predictions = predictNext(model, rows, daysAhead);
      return { method: "ml", predictions, seasonalFactors };
    } catch (err) {
      console.warn("ML forecast failed, falling back to statistical method:", err.message);
    }
  }

  const points = useSeasonalBlend
    ? rows.map((r, i) => ({ x: i, y: r.value }))
    : rows.map((r, i) => {
        const dow = new Date(`${r.date}T00:00:00`).getDay();
        return {
          x: i,
          y: seasonalFactors[dow] > 0 ? r.value / seasonalFactors[dow] : r.value,
        };
      });
  const lr = linearRegression(points);
  const lastDate = rows[rows.length - 1].date;
  const predictions = [];
  for (let i = 1; i <= daysAhead; i++) {
    const dt = new Date(`${lastDate}T00:00:00`);
    dt.setDate(dt.getDate() + i);
    const trendVal = Math.max(0, lr.predict(rows.length - 1 + i));
    const dow = dt.getDay();
    const predicted = useSeasonalBlend
      ? Math.round(trendVal * (0.7 + 0.3 * seasonalFactors[dow]))
      : Math.max(0, Math.round(trendVal * seasonalFactors[dow]));
    predictions.push({ date: toDateOnlyString(dt), predicted });
  }
  return { method: "statistical", predictions, seasonalFactors };
}

function buildUtilForecast(rows) {
  const readiness = isReadyForML(rows);

  if (readiness.ready) {
    try {
      const model = trainModel(rows);
      const predictions = predictNext(model, rows, 1);
      return {
        method: "ml",
        predictedTomorrow: Math.min(100, predictions[0]?.predicted ?? 0),
      };
    } catch (err) {
      console.warn("Utilisation ML forecast failed, falling back:", err.message);
    }
  }

  const values = rows.map((r) => r.value);
  const smoothed = expSmooth(values);
  const predictedTomorrow = smoothed.length
    ? Math.min(100, Math.round(smoothed[smoothed.length - 1]))
    : 0;
  return { method: "statistical", predictedTomorrow };
}

module.exports = { buildDailyForecast, buildUtilForecast };
