const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const FareRate = sequelize.define(
    'FareRate',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      route_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'routes', key: 'id' },
      },
      category: {
        type: DataTypes.ENUM('regular', 'student', 'senior_citizen', 'pwd', 'discounted'),
        allowNull: false,
      },
      rate: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      effective_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
    },
    {
      tableName: 'fare_rates',
      timestamps: true,
      underscored: true,
    }
  );

  return FareRate;
};
