const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const FareSettings = sequelize.define(
    "FareSettings",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      minimum_fare: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      base_distance_km: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
        defaultValue: 5,
      },
      rate_per_km: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: false,
        defaultValue: 0,
      },
      regular_discount_percent: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
        defaultValue: 0,
      },
      student_discount_percent: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
        defaultValue: 20,
      },
      senior_citizen_discount_percent: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
        defaultValue: 20,
      },
      pwd_discount_percent: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
        defaultValue: 20,
      },
      discounted_discount_percent: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
        defaultValue: 20,
      },
      effective_date: { type: DataTypes.DATEONLY, allowNull: false },
    },
    {
      tableName: "fare_settings",
      timestamps: true,
      underscored: true,
    },
  );

  return FareSettings;
};
