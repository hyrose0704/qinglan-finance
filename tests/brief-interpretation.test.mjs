import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretMorningEdition } from "../lib/brief-interpretation.ts";

const date = "2026-11-19";
function move(id, change, name = id, tradingDay = date) {
  return { id, name, value: 100, date: tradingDay, change, source: "行情", url: "https://quote.eastmoney.com/" + id };
}
function news(title, publishedAt, topics = ["equity"], sourceId = "cnbc") {
  return { title, publishedAt, topics, sourceId, url: "https://www.cnbc.com/" + encodeURIComponent(title), note: "", period: "overnight" };
}
function review(movements, items = [], reviewDate = date, cutoff = "2026-11-20T09:00:00+08:00") {
  return interpretMorningEdition({ reviewDate, cutoff, movements, news: items });
}

test("the gold explanation changes with actual directions, precision and the contract used", () => {
  const gold = (g, usd) => review([move("domestic", 1), move("gold", g, "COMEX黄金连续期货"), move("dxy", usd)])[0];
  assert.match(gold(-2, 1).possibleReason, /美元升值/);
  assert.match(gold(-2, 1).counterEvidence, /反向/);
  assert.match(gold(-2, 1).counterEvidence, /期货/);
  assert.match(gold(2, 1).possibleReason, /同向/);
  assert.match(gold(-0.001, 1).possibleReason, /接近零/);
  assert.doesNotMatch(gold(null, 1).observation, /COMEX黄金连续期货 0/);
});

test("a dated NAV may diverge from the index and an old NAV never supplies a reviewed return", () => {
  const index = move("nasdaq", 2);
  const fund = move("fund", -1);
  const [,actual] = review([index, fund]);
  assert.match(actual.observation, /019442.*−1.00%/);
  assert.match(actual.counterEvidence, /方向相反/);
  for (const movements of [[index], [index, { ...fund, date: "2026-11-18" }]]) {
    const [, missing] = review(movements);
    assert.match(missing.observation, /缺少复盘日/);
    assert.match(missing.watch, /2026-11-19/);
    assert.doesNotMatch(missing.observation, /019442[^。]*\+2.00%/);
  }
});

test("Beijing overnight items can precede the US close, while post-close reports are watch material", () => {
  const early = news("Nasdaq morning market", "2026-11-20T00:30:00+08:00");
  const late = news("Nvidia earnings release", "2026-11-20T06:40:00+08:00");
  const stale = news("Apple unaudited headline", "2026-11-19T03:00:00+08:00");
  const outside = news("Nasdaq headline beyond cutoff", "2026-11-20T09:01:00+08:00");
  const [, both] = review([move("nasdaq", 2)], [outside, late, early, stale]);
  assert.ok(both.sources.find(link => link.url === early.url && link.title.startsWith("交易窗口线索")));
  assert.ok(both.sources.find(link => link.url === late.url && link.title.startsWith("美股收盘后跟踪")));
  assert.ok(!both.sources.some(link => link.url === stale.url || link.url === outside.url));
  assert.match(review([move("nasdaq", 2)], [late])[1].possibleReason, /缺少/);
  const summerLate = news("Nasdaq summer headline", "2026-06-17T04:10:00+08:00");
  const [, summer] = review([move("nasdaq", 1, "NDX", "2026-06-16")], [summerLate], "2026-06-16", "2026-06-17T09:00:00+08:00");
  assert.ok(summer.sources.find(link => link.url === summerLate.url && link.title.startsWith("美股收盘后跟踪")));
});

test("publication at the Shanghai close is never a cause of the earlier domestic session", () => {
  const follow = news("Gold afternoon review", "2026-11-19T15:30:00+08:00", ["gold"]);
  const [result] = review([move("domestic", -0.4)], [follow]);
  assert.ok(result.sources.find(link => link.url === follow.url && link.title.startsWith("后续跟踪")));
  assert.match(result.watch, /下一交易时段/);
});

test("a US early-close afternoon bulletin requires a session-time check", () => {
  const possibleEarlyClose = news("Nasdaq afternoon update", "2026-11-20T03:00:00+08:00");
  const [, result] = review([move("nasdaq", 3)], [possibleEarlyClose]);
  assert.match(result.possibleReason, /提前收盘/);
  assert.ok(result.sources.find(link => link.url === possibleEarlyClose.url && link.title.startsWith("需核对")));
});

test("named evidence drives a specific channel only in its possible trading window", () => {
  const earnings = news("Nvidia earnings and revenue guidance", "2026-11-19T23:30:00+08:00");
  const filing = news("AMD drops after short seller report", "2026-11-20T06:00:00+08:00");
  const minutes = news("Minutes of the Federal Open Market Committee", "2026-11-19T03:00:00+08:00", ["rates"], "fed");
  const [gold, index] = review([move("gold", -1), move("dxy", 1), move("nasdaq", 2)], [minutes, earnings, filing]);
  assert.match(gold.possibleReason, /美联储会议纪要.*03:00.*常规/);
  assert.match(index.possibleReason, /英伟达业绩报道.*公告前.*预期/);
  assert.doesNotMatch(index.possibleReason, /AMD/);
  const [, onlyLate] = review([move("nasdaq", 2)], [filing]);
  assert.doesNotMatch(onlyLate.possibleReason, /AMD/);
  assert.match(onlyLate.watch, /AMD争议报道.*下一个美股/);
});

test("Sunday and Monday reports keep weekend dates and never infer a flat or repeated close", () => {
  const friday = [move("domestic", 1, "Au99.99", "2026-11-20"), move("nasdaq", 2, "NDX", "2026-11-20")];
  for (const [day, issue] of [["2026-11-21", "2026-11-22"], ["2026-11-22", "2026-11-23"]]) {
    const headline = news("Nvidia earnings preview", day + "T20:00:00+08:00");
    const [gold, index] = review(friday, [headline], day, issue + "T09:00:00+08:00");
    for (const asset of [gold, index]) {
      assert.ok(asset.observation.includes(day));
      assert.match(asset.observation, /周末/);
      assert.doesNotMatch(asset.observation, /0\.00%|1\.00%|2\.00%/);
    }
    assert.match(gold.watch, /下一交易日/);
    assert.match(index.watch, /英伟达业绩报道.*下次收盘/);
    assert.doesNotMatch(index.possibleReason, /英伟达/);
    assert.ok(index.sources.some(item => item.title.startsWith("周末跟踪")));
  }
});

test("a weekend report preserves genuinely dated quotes and distinguishes a partial market gap", () => {
  const day = "2026-11-21", cutoff = "2026-11-22T09:00:00+08:00";
  const offshore = move("gold", -1, "国际现货黄金", day), dxy = move("dxy", 2, "美元指数", day);
  const nav = move("fund", -0.75, "019442", day);
  const [partialGold, partialFund] = review([offshore, dxy, nav], [], day, cutoff);
  assert.match(partialGold.observation, /周末.*Au99.99.*国际现货黄金 −1.00%/);
  assert.match(partialGold.possibleReason, /美元升值/);
  assert.match(partialFund.observation, /周末.*019442.*−0.75%/);
  assert.match(partialFund.possibleReason, /估值时点/);
  const [actualGold, actualFund] = review([move("domestic", 0, "Au99.99", day), move("nasdaq", -3, "NDX", day)], [], day, cutoff);
  assert.match(actualGold.observation, /Au99.99 0.00%/);
  assert.match(actualFund.observation, /−3.00%.*周末/);
  assert.match(actualFund.watch, /下一净值/);
});
