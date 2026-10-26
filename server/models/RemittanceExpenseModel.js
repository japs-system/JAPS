const { DataTypes } = require('sequelize');
const EXPENSE_TYPES = require('./expenseTypes');

module.exports = (sequelize) => {
  const RemittanceExpense = sequelize.define(
    'RemittanceExpense',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      remittance_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'remittances', key: 'id' },
      },
      expense_type: {
        type: DataTypes.ENUM(...EXPENSE_TYPES),
        allowNull: false,
      },
      amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
      },
    },
    {
      tableName: 'remittance_expenses',
      timestamps: true,
      underscored: true,
    }
  );

  return RemittanceExpense;
};
