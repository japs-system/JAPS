const express = require("express");
const router = express.Router();
const {
  getBuses,
  createBus,
  updateBus,
  deleteBus,
  assignCrew,
  getCrewHistory,
  getTrips,
  createTrip,
  createTripsBulk,
  deleteTrip,
  getRoutes,
} = require("../controllers/busController");
const { authenticate, authorize, OWNER_LEVEL_ROLES } = require("../middleware/auth");

router.use(authenticate, authorize(...OWNER_LEVEL_ROLES));

router.get("/", getBuses);
router.post("/", createBus);
router.put("/:id", updateBus);
router.delete("/:id", deleteBus);
router.put("/:id/assign-crew", assignCrew);
router.get("/:id/crew-history", getCrewHistory);

router.get("/trips", getTrips);
router.post("/trips/bulk", createTripsBulk);
router.post("/trips", createTrip);
router.delete("/trips/:id", deleteTrip);

router.get("/routes", getRoutes);

module.exports = router;
