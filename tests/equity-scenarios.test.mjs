import test from "node:test";
import assert from "node:assert/strict";
import { compareEquityScenarios, EQUITY_CASE } from "../lib/equity-scenarios.ts";

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `Expected ${actual} to equal ${expected}`);
}

test("three cases use the same reference price and keep earnings and multiple effects separate", () => {
  const result = compareEquityScenarios(10, 16);
  closeTo(result.downside.price, 16.8);
  closeTo(result.downside.differencePct, -47.5);
  closeTo(result.base.price, 32);
  closeTo(result.base.differencePct, 0);
  closeTo(result.upside.price, 52);
  closeTo(result.upside.differencePct, 62.5);
  closeTo(result.earningsBridge.marginEffect, 9.6);
  closeTo(result.earningsBridge.multipleEffect, 10.4);
  closeTo(result.earningsBridge.marginEffect + result.earningsBridge.multipleEffect, result.upside.price - result.base.price);
});

test("backsolved net margin recovers the reference price across available multiples", () => {
  for (let multiple = EQUITY_CASE.multiple.min; multiple <= EQUITY_CASE.multiple.max; multiple++) {
    const result = compareEquityScenarios(5, multiple);
    closeTo(result.requiredEps * multiple, EQUITY_CASE.referencePrice);
    closeTo(result.requiredMargin / 100 * EQUITY_CASE.revenue / EQUITY_CASE.dilutedShares, result.requiredEps);
  }
});

test("zero or negative earnings retain signed EPS and have no P/E-based price or percentage difference", () => {
  for (const margin of [-5, -3, 0, 3]) {
    const { downside, base, upside, earningsBridge } = compareEquityScenarios(margin, 8);
    for (const row of [downside, base, upside]) {
      if (row.eps <= 0) {
        assert.equal(row.price, null);
        assert.equal(row.differencePct, null);
      } else {
        assert.ok(row.price > 0);
      }
    }
    assert.equal(earningsBridge === null, base.eps <= 0);
  }
});

test("out-of-range or non-finite assumptions cannot produce a displayed valuation", () => {
  for (const [margin, multiple] of [[NaN, 16], [Infinity, 16], [10, NaN], [10, Infinity], [-6, 8], [26, 8], [10, 7], [10, 33]]) {
    assert.throws(() => compareEquityScenarios(margin, multiple), RangeError);
  }
  assert.doesNotThrow(() => compareEquityScenarios(25, 32));
});
