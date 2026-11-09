const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateCommissions,
  calculateTotalExpenses,
  calculateTotalLess,
} = require("./remittanceCalculations");

test("excludes miscellaneous and counts half of diesel in total expenses", () => {
  assert.equal(
    calculateTotalExpenses([
      { expense_type: "miscellaneous", amount: "100.00" },
      { expense_type: "diesel", amount: "200.00" },
      { expense_type: "toll_fees", amount: "50.00" },
    ]),
    150,
  );
});

test("rounds half of diesel to centavos in total expenses", () => {
  assert.equal(
    calculateTotalExpenses([{ expense_type: "diesel", amount: "10.01" }]),
    5.01,
  );
});

test("calculates commissions from net gross and clamps negative amounts to zero", () => {
  assert.deepEqual(calculateCommissions(1000), {
    driver_commission: 120,
    conductor_commission: 100,
  });
  assert.deepEqual(calculateCommissions(-100), {
    driver_commission: 0,
    conductor_commission: 0,
  });
});

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
      other_deductions: "70.00",
      cash_deposit: "40.00",
      driver_officer_share: "50.00",
      conductor_officer_share: "60.00",
    }),
    480,
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
