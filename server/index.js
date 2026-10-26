require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { sequelize } = require("./models");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const busRoutes = require("./routes/busRoutes");
const routeRoutes = require("./routes/routeRoutes");
const fareSettingsRoutes = require("./routes/fareSettingsRoutes");
const conductorRoutes = require("./routes/conductorRoutes");
const driverRoutes = require("./routes/driverRoutes");
const auditTellerRoutes = require("./routes/auditTellerRoutes");
const ownerRoutes = require("./routes/ownerRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(
	cors({
		origin: process.env.CLIENT_URL || "http://localhost:2736",
		credentials: true,
	}),
);
app.use(express.json());
app.use(cookieParser());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/buses", busRoutes);
app.use("/api/routes", routeRoutes);
app.use("/api/fare-settings", fareSettingsRoutes);
app.use("/api/conductor", conductorRoutes);
app.use("/api/driver", driverRoutes);
app.use("/api/audit-teller", auditTellerRoutes);
app.use("/api/owner", ownerRoutes);
app.use("/api/notifications", notificationRoutes);

// DB sync + server start
// DB_SYNC_MODE: "alter" (default, safe — adds/adjusts columns without dropping
// data) | "force" (drops and recreates every table — destroys all data, only
// for a deliberate local reset) | "none" (no schema sync, e.g. against a
// manually-migrated database).
const SYNC_MODE = process.env.DB_SYNC_MODE || "alter";
const syncOptions =
	SYNC_MODE === "force" ? { force: true } : SYNC_MODE === "none" ? {} : { alter: true };

if (SYNC_MODE === "force") {
	console.warn(
		"⚠ DB_SYNC_MODE=force — every table will be dropped and recreated, destroying all existing data.",
	);
}

sequelize
	.authenticate()
	.then(() => {
		console.log("Database connected.");
		return sequelize.sync(syncOptions);
	})
	.then(() => {
		app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
	})
	.catch((err) => {
		console.error("Unable to connect to the database:", err);
		process.exit(1);
	});