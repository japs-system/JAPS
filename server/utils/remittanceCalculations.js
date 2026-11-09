const calculateTotalExpenses = (expenses = []) => {
  const total = expenses.reduce((sum, expense) => {
    const amount = Number(expense.amount || 0);
    if (expense.expense_type === "miscellaneous") return sum;
    return sum + (expense.expense_type === "diesel" ? amount / 2 : amount);
  }, 0);

  return Math.round((total + Number.EPSILON) * 100) / 100;
};

const calculateCommissions = (netGross) => {
  const net = Math.max(0, Number(netGross) || 0);
  return {
    driver_commission: Math.round(net * 0.12),
    conductor_commission: Math.round(net * 0.1),
  };
};

const calculateTotalLess = ({
  expenses = [],
  driver_commission = 0,
  conductor_commission = 0,
  bonus_allowance = 0,
  other_deductions = 0,
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
    Number(other_deductions || 0) +
    Number(cash_deposit || 0) +
    Number(driver_officer_share || 0) +
    Number(conductor_officer_share || 0);

  return Math.round((total + Number.EPSILON) * 100) / 100;
};

module.exports = { calculateCommissions, calculateTotalExpenses, calculateTotalLess };
