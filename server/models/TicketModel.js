const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Ticket = sequelize.define(
    "Ticket",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      trip_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "trips", key: "id" },
      },
      ticket_number: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      category: {
        type: DataTypes.ENUM(
          "regular",
          "student",
          "senior_citizen",
          "pwd",
          "discounted",
        ),
        // Set only when every passenger on the ticket is the same category; mixed-group
        // tickets leave it null and are described by `passengers` instead.
        allowNull: true,
        defaultValue: "regular",
      },
      // One ticket can cover a group: [{ category, quantity, unit_fare, subtotal }].
      // Null on tickets issued before group ticketing (one passenger, `category`, `fare`).
      passengers: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      passenger_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      boarding_point: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      boarding_km: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
      },
      dropping_point: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      dropping_km: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
      },
      distance_km: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
      },
      // Total amount for the whole ticket (sum of the passenger subtotals).
      fare: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      issued_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "tickets",
      timestamps: true,
      underscored: true,
    },
  );

  return Ticket;
};
