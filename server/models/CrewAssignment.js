const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CrewAssignment = sequelize.define(
    'CrewAssignment',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      bus_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'bus_info', key: 'id' },
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
      assigned_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      unassigned_at: {
        type: DataTypes.DATE,
        allowNull: true, // null = currently active assignment
      },
    },
    {
      tableName: 'crew_assignment',
      timestamps: false,
      underscored: true,
    }
  );

  return CrewAssignment;
};
