const TIME_ZONE = "Asia/Manila";
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATETIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

const isValidDateKey = (value) => {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const parseManilaDateTime = (value) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;

  const localMatch = LOCAL_DATETIME_PATTERN.exec(value);
  if (localMatch) {
    const [, dateKey, hours, minutes, seconds = "00", fraction = "0"] = localMatch;
    if (!isValidDateKey(dateKey) || Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) {
      return null;
    }
    const milliseconds = fraction.padEnd(3, "0");
    const date = new Date(`${dateKey}T${hours}:${minutes}:${seconds}.${milliseconds}+08:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (DATE_PATTERN.test(value)) {
    if (!isValidDateKey(value)) return null;
    return new Date(`${value}T00:00:00+08:00`);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const manilaDateKey = (value) => {
  const date = parseManilaDateTime(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const manilaDayBounds = (dateKey) => {
  if (!isValidDateKey(dateKey)) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDateKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  return {
    start: new Date(`${dateKey}T00:00:00+08:00`),
    endExclusive: new Date(`${nextDateKey}T00:00:00+08:00`),
  };
};

const manilaToday = () => manilaDateKey(new Date());

const scheduleDepartureError = (departure, now = new Date(), allowPast = false) => {
  const parsedDeparture = parseManilaDateTime(departure);
  if (!parsedDeparture) return "Provide a valid departure date and time.";

  const today = manilaDateKey(now);
  const departureDate = manilaDateKey(parsedDeparture);
  if (!allowPast && departureDate < today) return "Trips cannot be scheduled before today.";

  const currentYear = Number(today.slice(0, 4));
  const lastAllowedYear = (Math.floor(currentYear / 5) + 1) * 5;
  const lastAllowedDate = `${lastAllowedYear}-12-31`;
  if (departureDate > lastAllowedDate) {
    return `Trips can only be scheduled through ${lastAllowedDate}.`;
  }
  return null;
};

const addCalendarDays = (dateKey, days) => {
  if (!isValidDateKey(dateKey)) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
};

const assignTripNumbersByManilaDay = (trips, nextNumberByDate) => {
  const nextNumbers = new Map(nextNumberByDate);
  return trips.map((trip) => {
    const dateKey = manilaDateKey(trip.departureDate);
    const tripNumber = nextNumbers.get(dateKey) || 1;
    nextNumbers.set(dateKey, tripNumber + 1);
    return { ...trip, trip_number: tripNumber };
  });
};

module.exports = {
  addCalendarDays,
  assignTripNumbersByManilaDay,
  isValidDateKey,
  manilaDateKey,
  manilaDayBounds,
  manilaToday,
  parseManilaDateTime,
  scheduleDepartureError,
};
