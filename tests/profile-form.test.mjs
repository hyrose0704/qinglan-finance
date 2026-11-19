import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO, EMPTY_PROFILE, NUMERIC_PROFILE_FIELDS, calculate, sanitizeProfile } from "../lib/finance.ts";
import { createProfileDraft, saveProfileDraft, PROFILE_EXAMPLES } from "../lib/profile-form.ts";
import { buildLearningPlan } from "../lib/allocation.ts";
import { buildSiteContext } from "../lib/ai.ts";

const choices = { risk: "balanced", useGoldQuote: false, useFundNav: false };
const preferences = { horizon: "over5", income: "stable", experience: "familiar" };

test("a new personal form contains placeholders and no demonstration values", () => {
  const draft = createProfileDraft(DEMO);
  assert.ok(NUMERIC_PROFILE_FIELDS.every(key => draft[key] === "" && PROFILE_EXAMPLES[key].startsWith("例如")));
});
test("saving an entirely blank form makes every numerical field zero", () => {
  const profile = saveProfileDraft(createProfileDraft(DEMO), choices);
  assert.ok(NUMERIC_PROFILE_FIELDS.every(key => profile[key] === 0)); assert.deepEqual(profile.filledFields, []);
  assert.equal(profile.mode, "personal"); assert.equal(calculate(profile).total, 0);
});
test("an omitted field remains blank after save and reload while an explicit zero stays visible", () => {
  const draft = { ...createProfileDraft(DEMO), cash: "12000.50", monthlyDebt: "0" };
  const profile = saveProfileDraft(draft, choices), reloaded = createProfileDraft(sanitizeProfile(JSON.parse(JSON.stringify(profile))));
  assert.equal(reloaded.cash, "12000.5"); assert.equal(reloaded.monthlyDebt, "0"); assert.equal(reloaded.income, "");
  assert.equal(profile.income, 0); assert.deepEqual(profile.filledFields, ["cash", "monthlyDebt"]);
});
test("old personal records keep their saved amounts instead of being silently cleared", () => {
  const profile = { ...DEMO, mode: "personal" }; delete profile.filledFields;
  const draft = createProfileDraft(profile); assert.equal(draft.cash, String(profile.cash)); assert.equal(draft.goldCost, String(profile.goldCost));
});
test("missing imported personal values never inherit demonstration money", () => {
  const profile = sanitizeProfile({ mode: "personal", cash: 123 }); assert.equal(profile.cash, 123);
  assert.equal(profile.income, 0); assert.equal(profile.goldGrams, 0); assert.equal(profile.emergencyMonths, 0);
});
test("invalid numbers and emergency month ranges are rejected before saving", () => {
  const blank = createProfileDraft(DEMO);
  for (const values of [{ cash: "-1" }, { income: "not a number" }, { emergencyMonths: "25" }, { emergencyMonths: "1.5" }]) {
    assert.throws(() => saveProfileDraft({ ...blank, ...values }, choices));
  }
});
test("a missing emergency target or holding price prevents risky new allocations", () => {
  for (const profile of [{ ...DEMO, emergencyMonths: 0 }, { ...DEMO, goldPrice: 0 }, { ...DEMO, fundPrice: 0 }]) {
    const balances = calculate(profile), plan = buildLearningPlan(profile, balances, preferences);
    assert.equal(plan.blocked, true); assert.equal(plan.target.equity, 0); assert.equal(plan.target.gold, 0);
    assert.equal(balances.conditionalGold, 0);
  }
});
test("the AI context identifies blanks as unconfirmed zeros", () => {
  const context = JSON.parse(buildSiteContext(EMPTY_PROFILE, calculate(EMPTY_PROFILE), preferences));
  assert.ok(context.未填写但按0计算的字段.includes("monthlyDebt"));
  assert.ok(context.规划条件.待补条件.includes("应急金月数"));
});
