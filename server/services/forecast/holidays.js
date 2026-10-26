// Fixed-date PH public holidays (MM-DD, year-independent).
const FIXED_HOLIDAYS_MMDD = new Set([
  "01-01", // New Year's Day
  "04-09", // Araw ng Kagitingan
  "05-01", // Labor Day
  "06-12", // Independence Day
  "08-21", // Ninoy Aquino Day
  "11-01", // All Saints' Day
  "11-30", // Bonifacio Day
  "12-25", // Christmas Day
  "12-30", // Rizal Day
]);

// Movable-date holidays (Lunar New Year, Holy Week) — published dates,
// extend this table as new years approach.
const MOVABLE_HOLIDAYS = new Set([
  "2025-01-29",
  "2025-04-17",
  "2025-04-18",
  "2026-02-17",
  "2026-04-02",
  "2026-04-03",
  "2027-02-06",
  "2027-03-25",
  "2027-03-26",
]);

function isHoliday(dateStr) {
  const mmdd = dateStr.slice(5);
  if (FIXED_HOLIDAYS_MMDD.has(mmdd)) return true;
  return MOVABLE_HOLIDAYS.has(dateStr);
}

module.exports = { isHoliday };
