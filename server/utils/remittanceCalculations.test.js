const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateTotalLess } = require("./remittanceCalculations");

test("calculates Total Less from the specified expenses and remittance amounts", () => {
  assert.equal(
    calculateTotalLess({
      expenses: [
        { expense_type: "miscellaneous", amount: "100.00" },
        { expense_type: "diesel", amount: "200.00" },
        { expense_type: "toll_fees", amount: "500.00" },
      ],
      driver_commission: "10.00",
      conductor_commission: "20.00",
      bonus_allowance: "30.00",
      other_deductions: "1000.00",
      cash_deposit: "40.00",
      driver_officer_share: "50.00",
      conductor_officer_share: "60.00",
    }),
    410,
  );
});

test("rounds half of diesel to centavos", () => {
  assert.equal(
    calculateTotalLess({
      expenses: [{ expense_type: "diesel", amount: "10.01" }],
    }),
    5.01,
  );
});
