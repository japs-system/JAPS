const express = require("express");
const router = express.Router();
const { login, logout, me } = require("../controllers/authController");
const { authenticate } = require("../middleware/auth");

// POST /api/auth/login
router.post("/login", login);

// POST /api/auth/logout
router.post("/logout", logout);

// GET /api/auth/me
router.get("/me", authenticate, me);

module.exports = router;
