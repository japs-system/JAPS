const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PassengerCount = sequelize.define(
    'PassengerCount',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      trip_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'trips', key: 'id' },
      },
      category: {
        type: DataTypes.ENUM('regular', 'student', 'senior_citizen', 'pwd', 'discounted'),
        allowNull: false,
      },
      count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: 'passenger_counts',
      timestamps: true,
      underscored: true,
    }
  );

  return PassengerCount;
};
