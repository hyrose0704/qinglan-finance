import { test } from "node:test";
import assert from "node:assert/strict";
import { calculate, DEMO, sanitizeProfile, quoteFresh } from "../lib/finance.ts";
import { parseSina, parseKline, parseFund, normalizeIndexQuote } from "../lib/market.ts";

test("reserves and existing holdings are counted once", () => {
  const c = calculate(DEMO);
  assert.equal(c.total, 100000);
  assert.equal(c.emergency, 36000);
  assert.equal(c.freeCash, 4000);
  assert.equal(c.longTerm, 44000);
  assert.equal(c.surplus, 9000);
  assert.equal(c.target.stable + c.target.equity + c.target.gold, 44000);
  assert.equal(c.currentStress, 9000);
  assert.equal(c.conditionalGold, 0);
});
test("unfunded reserves or negative monthly cashflow prevent additional investment", () => {
  assert.equal(calculate({ ...DEMO, cash: 1000 }).conditionalGold, 0);
  assert.equal(calculate({ ...DEMO, income: 5000, goldGrams: 0 }).conditionalGold, 0);
});
test("purchase amount respects available cash, gold budget, allocation and risk room", () => {
  const p = { ...DEMO, cash: 100000, goldGrams: 0, goldCost: 0, fundUnits: 0, nearTerm: 0, maxLoss: 150 };
  assert.equal(calculate(p).conditionalGold, 1000);
  assert.equal(calculate({ ...p, goldBudget: 500 }).conditionalGold, 500);
  assert.equal(calculate({ ...p, maxLoss: 10000 }).conditionalGold, 7000);
});
test("malformed input and an empty portfolio never produce negative allocations or NaN", () => {
  const p = sanitizeProfile({ cash: -100, income: NaN, goldGrams: -5, fundUnits: 0, goldPrice: 0, fundPrice: 0 });
  const c = calculate(p);
  assert.equal(c.total, 0);
  assert.equal(c.longTerm, 0);
  assert.equal(c.goldWeight, 0);
  assert.ok(Object.values(c.target).every(v => v === 0));
});
test("future and stale timestamps cannot be treated as fresh", () => {
  const now = Date.parse("2026-11-19T09:00:00Z");
  assert.equal(quoteFresh("2026-11-19T08:55:00Z", now), true);
  assert.equal(quoteFresh("2026-11-18T08:55:00Z", now), false);
  assert.equal(quoteFresh("2026-11-20T08:55:00Z", now), false);
  assert.equal(quoteFresh(null, now), false);
});
test("Sina parsing preserves vendor timestamps and does not turn missing data into zero", () => {
  const q = parseSina('var hq_str_hf_XAU="2000,0,0,0,0,0,16:00:00,1900,0,0,0,0,2026-11-19,Gold";');
  assert.equal(q[0].value, 2000);
  assert.equal(q[0].asOf, "2026-11-19T16:00:00+08:00");
  assert.ok(Math.abs(q[0].change - (2000 / 1900 - 1) * 100) < 1e-10);
  assert.deepEqual(parseSina('var hq_str_hf_XAU="";'), []);
  assert.deepEqual(parseKline({ data: { klines: ["2026-11-19,0,,0,0"] } }), []);
});
test("fund valuation retains its NAV date and subscription restriction", () => {
  const fund = parseFund({ Data: { LSJZList: [{ FSRQ: "2026-11-17", DWJZ: "1.5", JZZZL: "-1", SGZT: "限制大额申购", SHZT: "开放赎回" }] } });
  assert.equal(fund.date, "2026-11-17");
  assert.equal(fund.buyStatus, "限制大额申购");
  assert.equal(parseFund({}), null);
});

test("scheduled fallback never labels Nasdaq futures as the cash index", () => {
  const result = normalizeIndexQuote({ mode: "snapshot", fetchedAt: "2026-11-19T08:00:00Z", errors: [], fund: null,
    histories: { gold: [], nasdaq: [{ date: "2026-11-17", value: 24000 }, { date: "2026-11-18", value: 25000 }] },
    quotes: [{ id: "nasdaq", name: "futures", symbol: "FUTURES", value: 27000, change: 1, unit: "point", asOf: null, source: "Sina", sourceUrl: "https://finance.sina.com.cn" }] });
  assert.equal(result.quotes[0].value, 25000);
  assert.equal(result.quotes[0].symbol, "NASDAQ 100 INDEX");
  assert.equal(result.quotes[0].asOf, null);
});
