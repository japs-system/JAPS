const express = require("express");
const {
  getStats,
  getRemittances,
  getRemittanceById,
  updateRemittance,
  approveRemittance,
  rejectRemittance,
} = require("../controllers/auditTellerController");
const { authenticate, authorize } = require("../middleware/auth");

const router = express.Router();

router.use(authenticate);
router.use(authorize("audit_teller"));

router.get("/stats", getStats);
router.get("/remittances", getRemittances);
router.get("/remittances/:id", getRemittanceById);
router.put("/remittances/:id", updateRemittance);
router.put("/remittances/:id/approve", approveRemittance);
router.put("/remittances/:id/reject", rejectRemittance);

module.exports = router;
