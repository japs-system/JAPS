const sequelize = require("../config/database");

const User = require("./UserModel")(sequelize);
const BusModel = require("./BusModel")(sequelize);
const BusCrewHistory = require("./BusCrewHistoryModel")(sequelize);
const Route = require("./RouteModel")(sequelize);
const RouteStop = require("./RouteStopModel")(sequelize);
const Trip = require("./TripModel")(sequelize);
const FareRate = require("./FareRateModel")(sequelize);
const FareSettings = require("./FareSettingsModel")(sequelize);
const PassengerCount = require("./PassengerCountModel")(sequelize);
const Ticket = require("./TicketModel")(sequelize);
const Remittance = require("./RemittanceModel")(sequelize);
const RemittanceExpense = require("./RemittanceExpenseModel")(sequelize);
const TripExpense = require("./TripExpenseModel")(sequelize);
const Notification = require("./NotificationModel")(sequelize);

// ── User ───────────────────────────────────────────────────────────────────
User.hasMany(Trip, { foreignKey: "driver_id", as: "driverTrips" });
User.hasMany(Trip, { foreignKey: "conductor_id", as: "conductorTrips" });
User.hasMany(Remittance, { foreignKey: "driver_id", as: "driverRemittances" });
User.hasMany(Notification, { foreignKey: "user_id", as: "notifications" });
User.hasMany(Remittance, {
  foreignKey: "conductor_id",
  as: "conductorRemittances",
});
User.hasMany(Remittance, {
  foreignKey: "approved_by",
  as: "approvedRemittances",
});

// ── BusModel ──────────────────────────────────────────────────────────────
BusModel.hasMany(Trip, { foreignKey: "bus_id" });
BusModel.hasMany(Remittance, { foreignKey: "bus_id" });
BusModel.belongsTo(User, { foreignKey: "driver_id", as: "assignedDriver" });
BusModel.belongsTo(User, {
  foreignKey: "conductor_id",
  as: "assignedConductor",
});
BusModel.belongsTo(Route, { foreignKey: "route_id", as: "defaultRoute" });
BusModel.hasMany(BusCrewHistory, { foreignKey: "bus_id", as: "crewHistory" });

// ── BusCrewHistory ────────────────────────────────────────────────────────
BusCrewHistory.belongsTo(BusModel, { foreignKey: "bus_id" });
BusCrewHistory.belongsTo(User, { foreignKey: "driver_id", as: "driver" });
BusCrewHistory.belongsTo(User, { foreignKey: "conductor_id", as: "conductor" });

// ── Route ──────────────────────────────────────────────────────────────────
Route.hasMany(Trip, { foreignKey: "route_id" });
Route.hasMany(FareRate, { foreignKey: "route_id" });
Route.hasMany(RouteStop, { foreignKey: "route_id", as: "stops" });

// ── RouteStop ─────────────────────────────────────────────────────────────
RouteStop.belongsTo(Route, { foreignKey: "route_id" });

// ── Trip ───────────────────────────────────────────────────────────────────
Trip.belongsTo(BusModel, { foreignKey: "bus_id" });
Trip.belongsTo(Route, { foreignKey: "route_id" });
Trip.belongsTo(User, { foreignKey: "driver_id", as: "driver" });
Trip.belongsTo(User, { foreignKey: "conductor_id", as: "conductor" });
Trip.belongsTo(Remittance, { foreignKey: "remittance_id" });
Trip.hasMany(PassengerCount, { foreignKey: "trip_id" });
Trip.hasMany(Ticket, { foreignKey: "trip_id" });
Trip.hasMany(TripExpense, { foreignKey: "trip_id" });

// ── FareRate ───────────────────────────────────────────────────────────────
FareRate.belongsTo(Route, { foreignKey: "route_id" });

// ── PassengerCount ─────────────────────────────────────────────────────────
PassengerCount.belongsTo(Trip, { foreignKey: "trip_id" });

// ── Ticket ─────────────────────────────────────────────────────────────────
Ticket.belongsTo(Trip, { foreignKey: "trip_id" });

// ── Remittance ─────────────────────────────────────────────────────────────
Remittance.belongsTo(BusModel, { foreignKey: "bus_id" });
Remittance.belongsTo(User, { foreignKey: "driver_id", as: "driver" });
Remittance.belongsTo(User, { foreignKey: "conductor_id", as: "conductor" });
Remittance.belongsTo(User, { foreignKey: "approved_by", as: "approver" });
Remittance.hasMany(Trip, { foreignKey: "remittance_id" });
Remittance.hasMany(RemittanceExpense, { foreignKey: "remittance_id" });

// ── RemittanceExpense ──────────────────────────────────────────────────────
RemittanceExpense.belongsTo(Remittance, { foreignKey: "remittance_id" });

// ── TripExpense (conductor's expense log) ───────────────────────────────────
TripExpense.belongsTo(Trip, { foreignKey: "trip_id" });
TripExpense.belongsTo(BusModel, { foreignKey: "bus_id" });
TripExpense.belongsTo(User, { foreignKey: "conductor_id", as: "conductor" });
TripExpense.belongsTo(Remittance, { foreignKey: "remittance_id" });
Remittance.hasMany(TripExpense, { foreignKey: "remittance_id" });
// ── Notifications ───────────────────────────────────────────────────────────
Notification.belongsTo(User, { foreignKey: "user_id" });

module.exports = {
  sequelize,
  User,
  BusModel,
  BusCrewHistory,
  Route,
  RouteStop,
  Trip,
  FareRate,
  FareSettings,
  PassengerCount,
  Ticket,
  Remittance,
  RemittanceExpense,
  TripExpense,
  Notification,
};
