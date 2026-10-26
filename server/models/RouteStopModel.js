const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const RouteStop = sequelize.define(
    "RouteStop",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      route_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "routes", key: "id" },
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      km_from_origin: {
        type: DataTypes.DECIMAL(8, 2),
        allowNull: false,
      },
    },
    {
      tableName: "route_stops",
      timestamps: true,
      underscored: true,
    },
  );

  return RouteStop;
};
