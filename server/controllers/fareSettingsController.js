
const { FareSettings } = require("../models");
const { isValidDateKey, manilaToday } = require("../utils/manilaTime");

// Fare configuration: 4 whole digits + 2 decimal places.
// Allowed range: 0 - 9999.99

const CONFIG_FIELDS = {
  minimum_fare: "Minimum fare",
  base_distance_km: "Base distance",
  rate_per_km: "Rate per km",
};

// Discount configuration: up to 3 whole digits + 2 decimals.
// Allowed range: 0 - 100.

const DISCOUNT_FIELDS = {
  regular_discount_percent: "Regular discount",
  student_discount_percent: "Student discount",
  senior_citizen_discount_percent: "Senior Citizen discount",
  pwd_discount_percent: "PWD discount",
};

// Validate decimal number format.
const hasFormat = (value, maxWhole) => {
  if (value === null || value === undefined || value === "") {
    return false;
  }

  const pattern = new RegExp(
    "^\\d{1," + maxWhole + "}(\\.\\d{1,2})?$"
  );

  return pattern.test(String(value).trim()) &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0;
};

// Validate all fare settings.
const validateFareSettings = (body) => {

  // Validate fare configuration.
  for (const [field, label] of Object.entries(CONFIG_FIELDS)) {
    if (!hasFormat(body[field], 4)) {
      return `${label} must be a number up to 9999.99 (max 4 whole digits and 2 decimals).`;
    }
  }

  // Validate discounts.
  for (const [field, label] of Object.entries(DISCOUNT_FIELDS)) {
    if (
      !hasFormat(body[field], 3) ||
      Number(body[field]) > 100
    ) {
      return `${label} must be between 0 and 100 (max 2 decimals).`;
    }
  }

  // Validate effective date.
  const date = body.effective_date;

  if (!isValidDateKey(date)) {
    return "Effective date is required (YYYY-MM-DD).";
  }
  if (date < manilaToday()) return "Effective date cannot be before today.";

  return null;
};

// Only these fields are written to the database.
const pickSettings = (body) => ({
  minimum_fare: body.minimum_fare,
  base_distance_km: body.base_distance_km,
  rate_per_km: body.rate_per_km,
  regular_discount_percent: body.regular_discount_percent,
  student_discount_percent: body.student_discount_percent,
  senior_citizen_discount_percent: body.senior_citizen_discount_percent,
  pwd_discount_percent: body.pwd_discount_percent,
  effective_date: body.effective_date,
});

// GET /api/fare-settings
const getFareSettings = async (req, res) => {
  try {
    let settings = await FareSettings.findOne({
      order: [["id", "DESC"]],
    });

    if (!settings) {
      const today = new Date().toISOString().slice(0, 10);

      settings = await FareSettings.create({
        minimum_fare: 50.0,
        base_distance_km: 5.0,
        rate_per_km: 2.0,
        regular_discount_percent: 0,
        student_discount_percent: 20,
        senior_citizen_discount_percent: 20,
        pwd_discount_percent: 20,
        effective_date: today,
      });
    }

    return res.json(settings);

  } catch (err) {
    console.error("Error loading fare settings:", err);
    return res.status(500).json({
      message: "Could not load fare settings.",
    });
  }
};

// PUT /api/fare-settings
const updateFareSettings = async (req, res) => {
  try {
    const error = validateFareSettings(req.body);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    const data = pickSettings(req.body);

    let settings = await FareSettings.findOne({
      order: [["id", "DESC"]],
    });

    if (!settings) {
      settings = await FareSettings.create(data);
    } else {
      await settings.update(data);
    }

    return res.json(settings);

  } catch (err) {
    console.error("Error updating fare settings:", err);

    return res.status(500).json({
      message: "Could not save fare settings.",
    });
  }
};

module.exports = {
  getFareSettings,
  updateFareSettings,
};
