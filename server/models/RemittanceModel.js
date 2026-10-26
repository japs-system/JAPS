const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Remittance = sequelize.define(
    "Remittance",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      bus_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "buses", key: "id" },
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
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      no_of_trips: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      gross_income: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      total_expenses: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      net_gross: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      driver_commission: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      conductor_commission: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      bonus_allowance: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
      },
      other_deductions: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0,
      },
      cash_deposit: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      total_less: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      net_collection: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      cash_received: { 
        type: DataTypes.DECIMAL(12, 2), 
        allowNull: true,
      },
      driver_officer_share: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      conductor_officer_share: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("submitted", "approved", "rejected", "finalized"),
        defaultValue: "submitted",
      },
      submitted_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      // Set when the conductor corrects and resubmits a rejected remittance. The status
      // goes back to "submitted"; this is what marks it as "Updated" for the audit teller.
      resubmitted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      approved_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      approved_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      teller_remarks: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "remittances",
      timestamps: true,
      underscored: true,
    },
  );

  return Remittance;
};
