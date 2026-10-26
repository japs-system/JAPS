const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { User } = require("../models");

const ROLE_REDIRECT = {
  owner: "/owner/dashboard",
  secretary: "/owner/dashboard",
  admin_staff: "/owner/dashboard",
  audit_teller: "/audit-teller/dashboard",
  conductor: "/conductor/trips",
  driver: "/driver/dashboard",
};

const isProduction = process.env.NODE_ENV === "production";

const COOKIE_OPTIONS = {
  httpOnly: true,
  // Cross-site cookies (frontend and backend on different domains) require
  // SameSite=None, which browsers only honor when Secure is also set.
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  maxAge: 8 * 60 * 60 * 1000, // 8 hours
};

const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res
      .status(400)
      .json({ message: "Username and password are required." });
  }

  const user = await User.findOne({ where: { username } });

  if (!user) {
    return res.status(401).json({ message: "Invalid credentials." });
  }

  if (!user.is_active) {
    return res.status(403).json({ message: "Account is deactivated." });
  }

  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    return res.status(401).json({ message: "Invalid credentials." });
  }

  const token = jwt.sign(
    { id: user.id, employee_id: user.employee_id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" },
  );

  res.cookie("token", token, COOKIE_OPTIONS);

  return res.status(200).json({
    redirectUrl: ROLE_REDIRECT[user.role] ?? "/dashboard",
  });
};

const logout = (req, res) => {
  res.clearCookie("token", COOKIE_OPTIONS);
  return res.status(200).json({ message: "Logged out successfully." });
};

// GET /api/auth/me — returns current user from cookie/JWT
const me = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: [
        "id",
        "employee_id",
        "username",
        "role",
        "first_name",
        "middle_name",
        "last_name",
        "email",
        "contact_number",
      ],
    });
    if (!user) return res.status(401).json({ message: "User not found." });
    return res.json(user);
  } catch (error) {
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = { login, logout, me };
