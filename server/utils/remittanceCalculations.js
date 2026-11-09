const calculateTotalLess = ({
  expenses = [],
  driver_commission = 0,
  conductor_commission = 0,
  bonus_allowance = 0,
  cash_deposit = 0,
  driver_officer_share = 0,
  conductor_officer_share = 0,
}) => {
  const expenseAmount = (type) =>
    expenses.reduce(
      (sum, expense) =>
        sum + (expense.expense_type === type ? Number(expense.amount || 0) : 0),
      0,
    );

  const total =
    expenseAmount("miscellaneous") +
    expenseAmount("diesel") / 2 +
    Number(driver_commission || 0) +
    Number(conductor_commission || 0) +
    Number(bonus_allowance || 0) +
    Number(cash_deposit || 0) +
    Number(driver_officer_share || 0) +
    Number(conductor_officer_share || 0);

  return Math.round((total + Number.EPSILON) * 100) / 100;
};

module.exports = { calculateTotalLess };
