/** Expense categories — mirrors server/models/expenseTypes.js. */
export const EXPENSE_TYPES: { value: string; label: string }[] = [
  { value: 'officer', label: 'Officer / Police' },
  { value: 'toll_fees', label: 'Toll Fees' },
  { value: 'parking', label: 'Parking' },
  { value: 'ppa', label: 'PPA (Port Authority)' },
  { value: 'washing', label: 'Bus Washing' },
  { value: 'diesel', label: 'Diesel / Fuel' },
  { value: 'caller_grand_terminal', label: 'Caller (Grand Terminal)' },
  { value: 'caller_calamba_terminal', label: 'Caller (Calamba Terminal)' },
  { value: 'pwd', label: 'PWD / Senior Discount' },
  { value: 'miscellaneous', label: 'Miscellaneous' },
];

export const expenseTypeLabel = (type: string): string =>
  EXPENSE_TYPES.find((t) => t.value === type)?.label ?? type;
