const express = require("express");
const router = express.Router();
const {
  getFareSettings,
  updateFareSettings,
} = require("../controllers/fareSettingsController");
const { authenticate, authorize, OWNER_LEVEL_ROLES } = require("../middleware/auth");

// GET is accessible by owner-level roles and conductor (for ticketing)
router.get("/", authenticate, authorize(...OWNER_LEVEL_ROLES, "conductor"), getFareSettings);

// PUT is owner-level roles only
router.put("/", authenticate, authorize(...OWNER_LEVEL_ROLES), updateFareSettings);

module.exports = router;
