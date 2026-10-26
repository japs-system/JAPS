const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Route = sequelize.define(
    "Route",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      origin: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      destination: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      distance_km: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: true,
      },
      minimum_fare: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      rate_per_km: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
      },
    },
    {
      tableName: "routes",
      timestamps: true,
      underscored: true,
    },
  );

  return Route;
};
