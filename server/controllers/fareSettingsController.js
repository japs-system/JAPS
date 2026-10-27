const { FareSettings } = require("../models");

// Input limits (the client form enforces the same ones):
//   fare configuration -> up to 4 whole digits + 2 decimals (0 - 9999.99)
//   category discounts -> up to 3 whole digits + 2 decimals, never above 100
const CONFIG_FIELDS = {
  minimum_fare: "Minimum fare",
  base_distance_km: "Base distance",
  rate_per_km: "Rate per km",
};

const DISCOUNT_FIELDS = {
  regular_discount_percent: "Regular discount",
  student_discount_percent: "Student discount",
  senior_citizen_discount_percent: "Senior Citizen discount",
  pwd_discount_percent: "PWD discount",
};

const hasFormat = (value, maxWhole) => {
  if (value === null || value === undefined || value === "") return false;
  return new RegExp(`^\\d{1,${maxWhole}}(\\.\\d{1,2})?$`).test(String(value).trim());
};

// Returns an error message, or null when the body is valid.
const validateFareSettings = (body) => {
  for (const [field, label] of Object.entries(CONFIG_FIELDS)) {
    if (!hasFormat(body[field], 4)) {
      return `${label} must be a number up to 9999.99 (max 4 whole digits and 2 decimals).`;
    }
  }
  for (const [field, label] of Object.entries(DISCOUNT_FIELDS)) {
    if (!hasFormat(body[field], 3) || Number(body[field]) > 100) {
      return `${label} must be between 0 and 100 (max 2 decimals).`;
    }
  }
  const date = body.effective_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? "")) || Number.isNaN(Date.parse(date))) {
    return "Effective date is required (YYYY-MM-DD).";
  }
  return null;
};

// Only these fields are ever written, whatever else the request contains.
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
  // Always return the latest record (id = 1, or most recent)
  let settings = await FareSettings.findOne({ order: [["id", "DESC"]] });
  if (!settings) {
    // Create default if none exists
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
};

// PUT /api/fare-settings
const updateFareSettings = async (req, res) => {
  const error = validateFareSettings(req.body);
  if (error) {
    return res.status(400).json({ message: error });
  }

  const data = pickSettings(req.body);

  let settings = await FareSettings.findOne({ order: [["id", "DESC"]] });
  if (!settings) {
    // Create new
    settings = await FareSettings.create(data);
  } else {
    // Update existing
    await settings.update(data);
  }
  return res.json(settings);
};

module.exports = { getFareSettings, updateFareSettings };