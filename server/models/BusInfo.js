const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const BusInfo = sequelize.define(
    'BusInfo',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      bus_number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      plate_number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      capacity: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive', 'under_maintenance'),
        defaultValue: 'active',
      },
      driver_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      conductor_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      route_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'routes', key: 'id' },
      },
    },
    {
      tableName: 'bus_info',
      timestamps: true,
      underscored: true,
    }
  );

  return BusInfo;
};
