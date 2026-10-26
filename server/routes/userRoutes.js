const express = require("express");
const router = express.Router();
const {
	getUsers,
	createUser,
	updateUser,
	deleteUser,
} = require("../controllers/userController");
const { authenticate, authorize, OWNER_LEVEL_ROLES } = require("../middleware/auth");

router.use(authenticate, authorize(...OWNER_LEVEL_ROLES));

router.get("/", getUsers);
router.post("/", createUser);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);

module.exports = router;
