const { isHoliday } = require("./holidays");

const FEATURE_ORDER = [
  "day_of_week",
  "day_of_month",
  "month",
  "is_holiday",
  "lag_1",
  "lag_7",
  "rolling_avg_7",
];

function buildDailyFeatures(dailyRows) {
  return dailyRows.map((row, i) => {
    const d = new Date(`${row.date}T00:00:00`);
    const lag1 = i >= 1 ? dailyRows[i - 1].value : row.value;
    const lag7 = i >= 7 ? dailyRows[i - 7].value : row.value;
    const windowStart = Math.max(0, i - 6);
    const window = dailyRows.slice(windowStart, i + 1);
    const rollingAvg7 = window.reduce((s, r) => s + r.value, 0) / window.length;

    return {
      date: row.date,
      features: {
        day_of_week: d.getDay(),
        day_of_month: d.getDate(),
        month: d.getMonth() + 1,
        is_holiday: isHoliday(row.date) ? 1 : 0,
        lag_1: lag1,
        lag_7: lag7,
        rolling_avg_7: rollingAvg7,
      },
      y: row.value,
    };
  });
}

function toVector(features) {
  return FEATURE_ORDER.map((key) => features[key]);
}

module.exports = { buildDailyFeatures, toVector, FEATURE_ORDER };
