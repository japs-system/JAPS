function linearRegression(points) {
  const n = points.length;
  if (n < 2)
    return {
      slope: 0,
      intercept: points[0]?.y ?? 0,
      predict: () => points[0]?.y ?? 0,
    };
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept, predict: (x) => slope * x + intercept };
}

function expSmooth(values, alpha = 0.3) {
  if (!values.length) return [];
  const result = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(alpha * values[i] + (1 - alpha) * result[i - 1]);
  }
  return result;
}

function computeSeasonalFactors(rows) {
  const dowTotals = Array(7).fill(0);
  const dowCounts = Array(7).fill(0);
  for (const r of rows) {
    const dow = new Date(`${r.date}T00:00:00`).getDay();
    dowTotals[dow] += r.value;
    dowCounts[dow]++;
  }
  const dowAvg = dowTotals.map((t, i) => (dowCounts[i] > 0 ? t / dowCounts[i] : 0));
  const globalAvg = dowAvg.reduce((s, v) => s + v, 0) / 7 || 1;
  return dowAvg.map((v) => v / globalAvg);
}

module.exports = { linearRegression, expSmooth, computeSeasonalFactors };
