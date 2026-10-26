const MIN_DAYS_FOR_ML = 60;

// Precondition: dailyRows must contain at most one row per distinct date
// (all real callers pre-aggregate via SQL GROUP BY <date> before calling this).
function isReadyForML(dailyRows, minDays = MIN_DAYS_FOR_ML) {
  const activeDays = dailyRows.filter((r) => r.value > 0).length;
  if (activeDays < minDays) {
    return {
      ready: false,
      reason: `only ${activeDays} active day(s) of history, need at least ${minDays}`,
    };
  }
  return { ready: true, reason: `${activeDays} active day(s) of history` };
}

module.exports = { isReadyForML, MIN_DAYS_FOR_ML };
