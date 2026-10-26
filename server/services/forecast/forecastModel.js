const { RandomForestRegression } = require("ml-random-forest");
const { buildDailyFeatures, toVector } = require("./featureBuilder");
const { isHoliday } = require("./holidays");

function trainModel(dailyRows) {
  const featureRows = buildDailyFeatures(dailyRows);
  const X = featureRows.map((r) => toVector(r.features));
  // ml-random-forest's underlying CART regressor (ml-cart) has a stopping-rule quirk:
  // a node stops splitting when its best candidate split's residual error is
  // *exactly* equal to the parent's (the root's parent error defaults to 0), which
  // means a split that fits its data perfectly (error === 0) is treated as "no
  // improvement" and the split is discarded, leaving the tree as a single leaf that
  // always predicts the sample mean. Deterministic/noise-free series (like this
  // module's own weekend-doubling test fixture) can trigger exactly that case,
  // since a lag feature ends up perfectly correlated with the label. Adding a
  // negligible, index-derived jitter to the training labels keeps residual errors
  // just off of zero so real splits still happen, without perceptibly changing
  // predictions (final output is rounded to the nearest whole unit anyway).
  const Y = featureRows.map((r, i) => r.y + ((i * 2654435761) >>> 0) % 1000 / 1e7);
  const model = new RandomForestRegression({ nEstimators: 100, seed: 42 });
  model.train(X, Y);
  return model;
}

function toDateOnlyString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, n) {
  // Build the output from local date components (getFullYear/getMonth/getDate)
  // instead of toISOString(), which serializes in UTC: on hosts running east of
  // UTC (e.g. UTC+8), parsing "YYYY-MM-DDT00:00:00" as local time and then
  // calling toISOString() shifts the date back by a day, silently corrupting
  // every forecasted date (and the day-of-week features derived from it).
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toDateOnlyString(d);
}

function predictNext(model, dailyRows, daysAhead) {
  const series = dailyRows.map((r) => ({ date: r.date, value: r.value }));
  const lastDate = series[series.length - 1].date;
  const predictions = [];

  for (let step = 1; step <= daysAhead; step++) {
    const nextDate = addDays(lastDate, step);
    const d = new Date(`${nextDate}T00:00:00`);
    const lag1 = series[series.length - 1].value;
    const lag7 = series.length >= 7 ? series[series.length - 7].value : lag1;
    const window = series.slice(Math.max(0, series.length - 7));
    const rollingAvg7 = window.reduce((s, r) => s + r.value, 0) / window.length;

    const features = {
      day_of_week: d.getDay(),
      day_of_month: d.getDate(),
      month: d.getMonth() + 1,
      is_holiday: isHoliday(nextDate) ? 1 : 0,
      lag_1: lag1,
      lag_7: lag7,
      rolling_avg_7: rollingAvg7,
    };
    const vector = toVector(features);

    const predicted = Math.max(0, Math.round(model.predict([vector])[0]));
    predictions.push({ date: nextDate, predicted });
    series.push({ date: nextDate, value: predicted });
  }

  return predictions;
}

module.exports = { trainModel, predictNext };
