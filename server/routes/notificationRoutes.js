const express = require("express");
const router = express.Router();
const { authenticate, authorize, OWNER_LEVEL_ROLES } = require("../middleware/auth"); // <-- match your existing import
const ctrl = require("../controllers/notificationController");

router.use(authenticate);
router.get("/", ctrl.getMyNotifications);
router.put("/read-all", ctrl.markAllRead);
router.put("/:id/read", ctrl.markRead);

module.exports = router;