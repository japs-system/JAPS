const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Trip = sequelize.define(
    "Trip",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      remittance_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "remittances", key: "id" },
      },
      bus_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "buses", key: "id" },
      },
      route_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "routes", key: "id" },
      },
      driver_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      conductor_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      trip_number: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      ticket_number_start: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      ticket_number_end: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      grand_total: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      departure_time: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      // When the trip actually left (set when the conductor starts it) — departure_time
      // above is the scheduled time.
      actual_departure_time: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      arrival_time: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("scheduled", "ongoing", "completed", "cancelled"),
        defaultValue: "scheduled",
      },
    },
    {
      tableName: "trips",
      timestamps: true,
      underscored: true,
    },
  );

  return Trip;
};
