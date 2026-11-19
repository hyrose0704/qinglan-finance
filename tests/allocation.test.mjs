import { test } from "node:test";
import assert from "node:assert/strict";
import { calculate, DEMO } from "../lib/finance.ts";
import { buildLearningPlan, compoundScenario, qdiiScenario, recoveryReturn, readPreferences } from "../lib/allocation.ts";
import { readLearningProgress } from "../lib/curriculum.ts";

const preferences = { horizon: "over5", income: "stable", experience: "familiar" };
const uninvested = { ...DEMO, cash: 100000, nearTerm: 0, goldGrams: 0, goldCost: 0, fundUnits: 0, fundCost: 0 };

test("missing planning conditions leave money unallocated instead of assuming suitability", () => {
  const plan = buildLearningPlan(DEMO, calculate(DEMO), readPreferences(null));
  assert.equal(plan.target.cash, 44000);
  assert.equal(plan.target.equity + plan.target.gold, 0);
  assert.equal(plan.missing.length, 3);
});

test("money needed within three years has no risk asset candidates", () => {
  const plan = buildLearningPlan(DEMO, calculate(DEMO), { ...preferences, horizon: "within3" });
  assert.deepEqual(plan.target, { cash: 44000, equity: 0, gold: 0 });
});

test("candidate losses fit the declared hypothetical loss budget", () => {
  const profile = { ...uninvested, maxLoss: 1500 };
  const plan = buildLearningPlan(profile, calculate(profile), preferences);
  assert.ok(plan.targetStress <= 1500);
  assert.ok(plan.targetStress > 1499);
  assert.ok(Math.abs(plan.target.cash + plan.target.equity + plan.target.gold - 64000) < 0.001);
});

test("variable income tightens the selected template", () => {
  const profile = { ...uninvested, maxLoss: 100000 };
  const plan = buildLearningPlan(profile, calculate(profile), { ...preferences, income: "variable" });
  assert.equal(plan.target.equity, 16000);
  assert.equal(plan.target.gold, 6400);
});

test("learning product rules keeps the stock allocation below the baseline template", () => {
  const profile = { ...uninvested, maxLoss: 100000 };
  const plan = buildLearningPlan(profile, calculate(profile), { ...preferences, experience: "learning" });
  assert.equal(plan.target.equity, 12800);
  assert.equal(plan.target.gold, 6400);
});

test("new monthly money fills an existing reserve gap before risk assets", () => {
  const profile = { ...DEMO, cash: 55500 };
  const plan = buildLearningPlan(profile, calculate(profile), preferences);
  assert.deepEqual(plan.monthly, { reserve: 500, cash: 8500, equity: 0, gold: 0 });
});

test("a monthly deficit prevents additional risk commitments", () => {
  const profile = { ...DEMO, income: 5000 };
  const plan = buildLearningPlan(profile, calculate(profile), preferences);
  assert.deepEqual(plan.monthly, { reserve: 0, cash: 0, equity: 0, gold: 0 });
});

test("existing exposure is included in the risk room for new monthly money", () => {
  const profile = { ...uninvested, maxLoss: 100, fundUnits: 100 };
  const plan = buildLearningPlan(profile, calculate(profile), preferences);
  const after = plan.currentStress + plan.monthly.equity * 0.4 + plan.monthly.gold * 0.2;
  assert.ok(after <= 100);
  assert.ok(Math.abs(Object.values(plan.monthly).reduce((sum, value) => sum + value, 0) - 9000) < 0.001);
});

test("an existing loss budget breach leaves additional monthly money in cash", () => {
  const plan = buildLearningPlan(DEMO, calculate(DEMO), preferences);
  assert.equal(plan.currentStress, 12000);
  assert.deepEqual(plan.monthly, { reserve: 0, cash: 9000, equity: 0, gold: 0 });
});

test("gold additions respect the remaining holding cost cap", () => {
  const profile = { ...uninvested, goldGrams: 1, goldPrice: 100, goldCost: 100, goldBudget: 150, maxLoss: 100000 };
  const plan = buildLearningPlan(profile, calculate(profile), preferences);
  assert.ok(plan.monthly.gold > 0 && plan.monthly.gold <= 50);
});

test("zero stated loss tolerance keeps candidate risk allocations at zero", () => {
  const profile = { ...uninvested, maxLoss: 0 };
  const plan = buildLearningPlan(profile, calculate(profile), preferences);
  assert.equal(plan.target.equity + plan.target.gold, 0);
});

test("zero necessary expenses require financial input verification", () => {
  const profile = { ...uninvested, expense: 0, monthlyDebt: 0 };
  const plan = buildLearningPlan(profile, calculate(profile), preferences);
  assert.equal(plan.blocked, true);
  assert.equal(plan.monthly.equity + plan.monthly.gold, 0);
});

test("zero return and zero fees preserve the sum of all contributions", () => {
  assert.deepEqual(compoundScenario(1000, 100, 0, 0, 1), { value: 2200, contributed: 2200 });
});

test("negative hypothetical returns can reduce the original principal", () => {
  assert.ok(Math.abs(compoundScenario(10000, 0, -20, 0, 1).value - 8000) < 0.001);
});

test("the scenario fee reduces the annual growth factor", () => {
  assert.ok(Math.abs(compoundScenario(10000, 0, 4, 1, 1).value - 10296) < 0.001);
});

test("invalid scenario assumptions are rejected", () => {
  assert.throws(() => compoundScenario(1000, 100, -100, 0, 1), RangeError);
});

test("currency effects multiply instead of adding to overseas asset returns", () => {
  assert.ok(Math.abs(qdiiScenario(10, -5) - 4.5) < 1e-10);
});

test("recovering from a loss uses the remaining capital as denominator", () => {
  assert.equal(recoveryReturn(20), 25);
  assert.equal(recoveryReturn(50), 100);
});

test("a total loss has no finite percentage recovery", () => {
  assert.throws(() => recoveryReturn(100), RangeError);
});

test("learning progress accepts only correct answers to existing lessons", () => {
  assert.deepEqual(readLearningProgress({ cash: 1, reserve: 0, unknown: 1 }), { cash: 1 });
});
