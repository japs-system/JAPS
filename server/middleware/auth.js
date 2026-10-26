const jwt = require("jsonwebtoken");

const authenticate = (req, res, next) => {
	const token = req.cookies?.token;

	if (!token) {
		return res.status(401).json({ message: "No token provided." });
	}

	const decoded = jwt.verify(token, process.env.JWT_SECRET);
	req.user = decoded;
	next();
};

const authorize = (...roles) => {
	return (req, res, next) => {
		if (!roles.includes(req.user.role)) {
			return res.status(403).json({ message: "Access denied." });
		}
		next();
	};
};

// Roles with full owner-portal access. `secretary` and `admin_staff` are
// functionally interchangeable with `owner` (see CLAUDE.md).
const OWNER_LEVEL_ROLES = ["owner", "secretary", "admin_staff"];

module.exports = { authenticate, authorize, OWNER_LEVEL_ROLES };
