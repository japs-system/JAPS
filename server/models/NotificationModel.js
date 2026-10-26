const { DataTypes } = require("sequelize");

module.exports = (sequelize) =>
  sequelize.define(
    "Notification",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      type: { type: DataTypes.STRING(50), allowNull: false },
      title: { type: DataTypes.STRING(150), allowNull: false },
      message: { type: DataTypes.STRING(500), allowNull: false },
      link: { type: DataTypes.STRING(255), allowNull: true },
      read_at: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: "notifications", createdAt: "created_at", updatedAt: false },
  );