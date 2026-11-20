import { test } from "node:test";
import assert from "node:assert/strict";
import { calculate, EMPTY_PROFILE } from "../lib/finance.ts";
import { HOLDINGS_SCENARIOS, holdingsScenario } from "../lib/holdings-scenario.ts";

const portfolio = { ...EMPTY_PROFILE, cash: 7000, fundUnits: 1000, fundPrice: 2, goldGrams: 10, goldPrice: 100 };
test("fund return compounds equity and FX, gold uses RMB once, and RMB cash is unchanged", () => {
  const model = holdingsScenario(portfolio, calculate(portfolio), HOLDINGS_SCENARIOS[1]);
  assert.ok(Math.abs(model.fundReturn + 13.6) < 1e-10);
  assert.ok(Math.abs(model.fundChange + 272) < 1e-10);
  assert.equal(model.goldChange, 50);
  assert.ok(Math.abs(model.totalChange + 222) < 1e-10);
});
test("a missing valuation blocks only its asset and the combined change", () => {
  for (const [price, missing, known] of [["fundPrice", "fundChange", "goldChange"], ["goldPrice", "goldChange", "fundChange"]]) {
    const profile = { ...portfolio, [price]: 0 };
    const model = holdingsScenario(profile, calculate(profile), HOLDINGS_SCENARIOS[0]);
    assert.equal(model[missing], null);
    assert.equal(typeof model[known], "number");
    assert.equal(model.totalChange, null);
    assert.equal(model.empty, false);
  }
});
test("cash-only portfolios have zero modeled change while a blank record is empty", () => {
  const cashOnly = { ...EMPTY_PROFILE, cash: 8000 };
  assert.equal(holdingsScenario(cashOnly, calculate(cashOnly), HOLDINGS_SCENARIOS[2]).totalChange, 0);
  assert.equal(holdingsScenario(cashOnly, calculate(cashOnly), HOLDINGS_SCENARIOS[2]).empty, false);
  assert.equal(holdingsScenario(EMPTY_PROFILE, calculate(EMPTY_PROFILE), HOLDINGS_SCENARIOS[2]).empty, true);
});
