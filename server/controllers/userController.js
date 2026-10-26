const bcrypt = require("bcrypt");
const { Sequelize } = require("sequelize");
const { User } = require("../models");
const { sendAccountCredentialsEmail } = require("../config/mailer");

const ALLOWED_ROLES = ["secretary", "admin_staff", "audit_teller", "conductor", "driver"];

// GET /api/users
const getUsers = async (req, res) => {
	const users = await User.findAll({
		where: { role: ALLOWED_ROLES },
		attributes: { exclude: ["password"] },
		order: [["last_name", "ASC"]],
	});
	return res.json(users);
};

// POST /api/users
const createUser = async (req, res) => {
	const { password, role, ...rest } = req.body;

	if (!ALLOWED_ROLES.includes(role)) {
		return res.status(400).json({ message: "Invalid role." });
	}

	const hashed = await bcrypt.hash(password, 12);

	let user;
	try {
		user = await User.create({ ...rest, role, password: hashed });
	} catch (err) {
		if (err instanceof Sequelize.UniqueConstraintError) {
			const field = err.errors?.[0]?.path ?? "field";
			return res.status(409).json({ message: `That ${field} is already in use.` });
		}
		if (err instanceof Sequelize.ValidationError) {
			return res.status(400).json({ message: err.errors?.[0]?.message ?? "Invalid data." });
		}
		throw err;
	}

	try {
		await sendAccountCredentialsEmail({
			to: user.email,
			employee_id: user.employee_id,
			username: user.username,
			password,
			role: user.role,
		});
	} catch (err) {
		console.error("Failed to send account credentials email:", err);
	}

	const { password: _, ...safe } = user.toJSON();
	return res.status(201).json(safe);
};

// PUT /api/users/:id
const updateUser = async (req, res) => {
	const user = await User.findByPk(req.params.id);

	if (!user) return res.status(404).json({ message: "User not found." });
	if (!ALLOWED_ROLES.includes(user.role)) {
		return res.status(403).json({ message: "Cannot modify this user." });
	}

	const { password, role, ...rest } = req.body;

	if (role && !ALLOWED_ROLES.includes(role)) {
		return res.status(400).json({ message: "Invalid role." });
	}

	const updates = { ...rest };
	if (role) updates.role = role;
	if (password) updates.password = await bcrypt.hash(password, 12);

	await user.update(updates);

	const { password: _, ...safe } = user.toJSON();
	return res.json(safe);
};

// DELETE /api/users/:id
const deleteUser = async (req, res) => {
	const user = await User.findByPk(req.params.id);

	if (!user) return res.status(404).json({ message: "User not found." });
	if (!ALLOWED_ROLES.includes(user.role)) {
		return res.status(403).json({ message: "Cannot delete this user." });
	}

	await user.destroy();
	return res.status(204).send();
};

module.exports = { getUsers, createUser, updateUser, deleteUser };
