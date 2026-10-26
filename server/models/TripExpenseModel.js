const { DataTypes } = require("sequelize");
const EXPENSE_TYPES = require("./expenseTypes");

// An expense a conductor logs during the day (toll, parking, diesel, …), optionally tied
// to a trip and a ticket on it. When the conductor later submits a remittance, the
// matching unremitted entries pre-fill its expense fields and get `remittance_id` set.
module.exports = (sequelize) => {
  const TripExpense = sequelize.define(
    "TripExpense",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      conductor_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      trip_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "trips", key: "id" },
      },
      bus_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "buses", key: "id" },
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      expense_type: {
        type: DataTypes.ENUM(...EXPENSE_TYPES),
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      // Ticket number on `trip_id` the expense relates to (ticket numbers restart per trip).
      ticket_number: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      remittance_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "remittances", key: "id" },
      },
    },
    {
      tableName: "trip_expenses",
      timestamps: true,
      underscored: true,
    },
  );

  return TripExpense;
};
