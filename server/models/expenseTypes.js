// Expense categories shared by RemittanceExpense (the remitted per-type totals) and
// TripExpense (the conductor's running expense log). Keep in sync with the client's
// expense-type labels (conductor remittances/expenses pages).
module.exports = [
  "officer",
  "toll_fees",
  "parking",
  "ppa",
  "pwd",
  "washing",
  "diesel",
  "caller_grand_terminal",
  "caller_calamba_terminal",
  "miscellaneous",
];
