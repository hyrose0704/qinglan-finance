import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_PROFILE } from "../lib/finance.ts";
import { briefHoldingsImpact } from "../lib/brief-holdings.ts";

const personal = { ...EMPTY_PROFILE, goldGrams: 10, fundUnits: 500, filledFields: ["goldGrams", "fundUnits"] };
const reviewDate = "2026-11-19";
const gold = { id: "domestic", unit: "元/克", date: reviewDate, value: 825.5, previousDate: "2026-11-18", previousValue: 820.5 };
const nav = { id: "fund", unit: "元/份", date: reviewDate, value: 1.2376, previousDate: "2026-11-18", previousValue: 1.2476 };
const edition = (...movements) => ({ reviewDate, movements });
const near = (value, expected) => assert.ok(typeof value === "number" && Math.abs(value - expected) < 1e-8);

test("uses the recorded quantities and each instrument's RMB close-to-close difference", () => {
  const snapshot = edition({ ...gold, change: 99 }, { ...nav, change: 99 });
  const original = structuredClone(snapshot);
  const result = briefHoldingsImpact({ ...personal, goldCost: 100000, goldPrice: 2000, fundPrice: 5 }, snapshot);
  near(result.rows[0].amount, 50);
  near(result.rows[1].amount, -5);
  near(result.total, 45);
  assert.equal(result.subtotal, null);
  assert.equal(result.rows[0].previousDate, gold.previousDate);
  assert.deepEqual(snapshot, original);
});

test("a pending NAV or a legacy archive never values fund units with an index or its reported percentage", () => {
  const fallback = { ...nav, id: "nasdaq", unit: "点", change: 20 };
  for (const fund of [fallback, { ...nav, date: "2026-11-18" }, { ...nav, unit: "美元/份" },
    { ...nav, previousValue: undefined, change: 5 }, { ...nav, previousDate: reviewDate },
    { ...nav, date: null, value: null, latestAvailable: { date: "2026-11-18", value: 1.25 } }]) {
    const result = briefHoldingsImpact(personal, edition(gold, fund));
    assert.equal(result.rows[1].state, "missing-price");
    assert.equal(result.rows[1].amount, null);
    assert.equal(result.total, null);
    near(result.subtotal, 50);
  }
  const beforeUpgrade = briefHoldingsImpact(personal, edition({ ...gold, previousDate: undefined, previousValue: undefined, change: 0.1 }));
  assert.equal(beforeUpgrade.total, null);
  assert.equal(beforeUpgrade.subtotal, null);
});

test("unfilled holdings and legacy ambiguous zeros cannot silently complete a total", () => {
  for (const profile of [
    { ...personal, goldGrams: 0, filledFields: ["fundUnits"] },
    { ...personal, goldGrams: 0, filledFields: undefined },
  ]) {
    const result = briefHoldingsImpact(profile, edition(gold, nav));
    assert.equal(result.rows[0].quantity, null);
    assert.equal(result.rows[0].state, "missing-quantity");
    assert.equal(result.rows[1].state, "estimated");
    assert.equal(result.total, null);
    near(result.subtotal, -5);
  }
  const verifiedZero = briefHoldingsImpact({ ...personal, goldGrams: 0 }, edition(nav));
  assert.equal(verifiedZero.rows[0].state, "zero");
  near(verifiedZero.total, -5);
  const blank = briefHoldingsImpact(EMPTY_PROFILE, edition(gold, nav));
  assert.equal(blank.total, null);
  assert.equal(blank.subtotal, null);
});

test("missing holiday quotes stay unknown for exposed holdings, and two explicit zero holdings give zero", () => {
  const weekend = { reviewDate: "2026-11-21", movements: [gold, nav] };
  const missing = briefHoldingsImpact(personal, weekend);
  assert.equal(missing.total, null);
  assert.equal(missing.subtotal, null);
  const onlyZero = briefHoldingsImpact({ ...personal, goldGrams: 0 }, weekend);
  assert.equal(onlyZero.total, null);
  assert.equal(onlyZero.subtotal, null);
  const zero = briefHoldingsImpact({ ...personal, goldGrams: 0, fundUnits: 0 }, weekend);
  assert.equal(zero.total, 0);
});

test("an incomparable distribution period preserves the provider's reason; a genuinely flat pair is measurable", () => {
  const flagged = { ...nav, previousValue: undefined, comparisonNote: "单位净值跨分红，缺少可比基准。" };
  const result = briefHoldingsImpact(personal, edition({ ...gold, value: gold.previousValue }, flagged));
  assert.equal(result.rows[1].note, flagged.comparisonNote);
  assert.equal(result.rows[0].state, "estimated");
  assert.equal(result.subtotal, 0);
  assert.equal(result.total, null);
});
