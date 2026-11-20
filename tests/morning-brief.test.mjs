import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSgeDaily, parseSgeDelayed, collectDomesticGold, domesticGoldChange, readDomesticGold } from "../lib/domestic-gold.ts";
import { morningWindow, parseMorningFeed, buildMorningEdition, readBriefArchive, mergeBriefArchives, supplementPastNavs, signedChange } from "../lib/morning-brief.ts";
import { parseWanjiaHistory, parseEastmoneyNavHistory, fundMovement, goldComparison, EASTMONEY_FUND_URL } from "../lib/brief-prices.ts";

const now = Date.parse("2026-11-20T01:05:00Z");
const row = (code = "Au99.99", day = "2026-11-19", close = "1000", percent = "0.00%") => `<tr>${[day, code, "1000", "1010", "990", close, "0", percent].map(value => `<td>${value}</td>`).join("")}</tr>`;
const delayed = `<h1>上海黄金交易所2026年11月20日延时行情</h1><table><tr>${["Au99.99", "1005", "1010", "990", "1000"].map(value => `<td><span>${value}</span></td>`).join("")}</tr></table>`;
const item = (date, title = "Gold declines as higher interest rates and a stronger dollar weigh", url = "https://www.cnbc.com/2026/11/19/gold.html") => `<item><title>${title}</title><pubDate>${date}</pubDate><link>${url}</link></item>`;
function edition(at = now) {
  const day = morningWindow(at).reviewDate, previous = new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10);
  const history = [{ date: previous, value: 1000 }, { date: day, value: 990 }, { date: morningWindow(at).date, value: 777 }];
  return buildMorningEdition({ now: at, domestic: { quote: null, daily: [{ date: day, open: 1000, high: 1010, low: 980, close: 990, change: -1 }] },
    spot: history, nasdaq: history, dxy: history, news: parseMorningFeed(item(`${day}T12:00:00Z`), "cnbc", at), sources: [] });
}

test("the domestic contract is Au99.99 spot rather than an international-board or deferred contract", () => {
  const rows = parseSgeDaily(`<table>${row("iAu99.99")}${row("Au(T+D)")}${row()}</table>`, now);
  assert.equal(rows.length, 1); assert.equal(rows[0].close, 1000); assert.equal(rows[0].change, 0);
});
test("missing and inconsistent SGE prices are never turned into zero or usable quotes", () => {
  assert.deepEqual(parseSgeDaily(row("Au99.99", "2026-11-19", "-"), now), []);
  assert.deepEqual(parseSgeDaily(row("Au99.99", "2026-11-19", "9999"), now), []);
  assert.deepEqual(parseSgeDaily(row("Au99.99", "2026-11-19", "1000", "10%"), now), []);
  assert.deepEqual(parseSgeDaily(row("Au99.99", "2026-11-21"), now), []);
});
test("commented legacy row numbers in the official HTML cannot shift price columns", () => {
  const html = row().replace("<tr>", '<tr><!-- <td style="width:30px">2</td> -->');
  const result = parseSgeDaily(html, now); assert.equal(result.length, 1); assert.equal(result[0].close, 1000);
});
test("a delayed quote retains its provider date without inventing a minute-level quote timestamp", () => {
  const quote = parseSgeDelayed(delayed, now); assert.equal(quote.price, 1005); assert.equal(quote.date, "2026-11-20");
  assert.equal(quote.kind, "delayed"); assert.equal(quote.asOf, undefined);
  assert.equal(parseSgeDelayed(delayed.replace("Au99.99", "iAu99.99"), now), null);
});
test("a failed delayed endpoint retains the newer dated quote and original collection time", () => {
  const first = collectDomesticGold(delayed, row(), now, null);
  const next = collectDomesticGold("", row(), now + 60000, first);
  assert.equal(next.quote.date, "2026-11-20"); assert.equal(next.quote.price, 1005);
  assert.equal(next.collectedAt, first.collectedAt); assert.equal(next.cached, true);
  const missing = collectDomesticGold("", "", now, null); assert.equal(missing.quote, null); assert.equal(missing.collectedAt, null);
});
test("domestic percentage comparisons use a prior close and remain missing without one", () => {
  const data = collectDomesticGold(delayed, row(), now, null);
  assert.ok(Math.abs(domesticGoldChange(data) - 0.5) < 1e-8);
  assert.equal(domesticGoldChange({ ...data, daily: [] }), null);
  assert.equal(readDomesticGold({ ...data, collectedAt: "2026-11-21T01:00:00Z" }, now), null);
});
test("the daily publishing boundary is exactly 09:00 in Asia/Shanghai", () => {
  assert.equal(morningWindow(Date.parse("2026-11-20T00:59:59Z")).date, "2026-11-19");
  assert.equal(morningWindow(Date.parse("2026-11-20T01:00:00Z")).date, "2026-11-20");
  assert.equal(morningWindow(now).reviewDate, "2026-11-19");
});
test("morning news distinguishes the previous Beijing calendar day from overnight news", () => {
  const news = parseMorningFeed(`<rss>${item("Thu, 19 Nov 2026 15:59:00 GMT")}${item("Thu, 19 Nov 2026 16:00:00 GMT", "Fed interest rates", "https://www.cnbc.com/2026/11/19/fed.html")}</rss>`, "cnbc", now);
  assert.equal(news.length, 2); assert.equal(news[0].period, "overnight"); assert.equal(news[1].period, "previous-day");
  assert.match(news[1].note, /较高利率.*美元走强/);
});
test("news after the fixed cutoff, old news and timezone-less publication dates are excluded", () => {
  const xml = item("2026-11-20T01:01:00Z") + item("2026-11-18T15:59:00Z") + item("2026-11-19 12:00:00");
  assert.deepEqual(parseMorningFeed(xml, "cnbc", now), []);
  assert.equal(parseMorningFeed(item("2026-11-20T01:00:00Z"), "cnbc", now).length, 1);
});
test("news links cannot escape the publisher allowlist and unrelated items are omitted", () => {
  assert.deepEqual(parseMorningFeed(item("2026-11-19T12:00:00Z", "Gold", "https://www.cnbc.com.unrelated.example/gold"), "cnbc", now), []);
  assert.deepEqual(parseMorningFeed(item("2026-11-19T12:00:00Z", "A recipe for breakfast"), "cnbc", now), []);
});
test("the report takes the exact previous trading date and never uses today's intraday row", () => {
  const report = edition(); assert.equal(report.movements[1].value, 990); assert.equal(report.movements[1].date, "2026-11-19");
  assert.ok(Math.abs(report.movements[1].change + 1) < 1e-8); assert.equal(report.reviewDate, "2026-11-19");
  assert.equal(readBriefArchive({ version: 1, editions: [report] }, now).editions.length, 1);
});
test("holidays and missing daily rows stay unavailable rather than reusing an older close as yesterday", () => {
  const report = buildMorningEdition({ now, domestic: null, spot: [{ date: "2026-11-18", value: 1000 }], nasdaq: [], dxy: [], news: [], sources: [] });
  assert.ok(report.movements.every(move => move.value === null && move.change === null));
  assert.equal(report.status, "partial"); assert.ok(report.gaps.some(gap => gap.includes("不以0代替")));
  assert.ok(report.gaps.some(gap => gap.includes("不作具体事件归因")));
});
test("a futures fallback is explicitly labeled and never presented as international spot", () => {
  const report = buildMorningEdition({ now, domestic: null, spot: [], goldFallback: [{ date: "2026-11-18", value: 1000 }, { date: "2026-11-19", value: 990 }], nasdaq: [], dxy: [], news: [], sources: [] });
  assert.equal(report.movements[1].name, "COMEX黄金连续期货"); assert.equal(report.movements[1].value, 990);
  assert.ok(report.gaps.some(gap => gap.includes("两者品种"))); assert.ok(report.analysis[1].text.includes("不能当作现货报价"));
});
test("report caches preserve issue dates and collection times and reject future issues or foreign links", () => {
  const report = edition(), cached = readBriefArchive({ version: 1, editions: [report] }, now + 3600000);
  assert.equal(cached.editions[0].generatedAt, report.generatedAt);
  assert.equal(readBriefArchive({ version: 1, editions: [edition(now + 86400000)] }, now).editions.length, 0);
  const changed = structuredClone(report); changed.news[0].url = "https://unrelated.example/";
  assert.equal(readBriefArchive({ version: 1, editions: [changed] }, now).editions.length, 0);
});
test("a temporary provider failure preserves the same issue's valid closes and their original collection times", () => {
  const previous = edition();
  const next = buildMorningEdition({ now: now + 60000, domestic: null, spot: [], nasdaq: [], dxy: [], news: [], sources: [], previous });
  assert.equal(next.movements[3].value, previous.movements[3].value);
  assert.equal(next.movements[3].collectedAt, previous.movements[3].collectedAt);
  assert.equal(next.news[0].publishedAt, previous.news[0].publishedAt);
  const anotherDay = buildMorningEdition({ now: now + 86400000, domestic: null, spot: [], nasdaq: [], dxy: [], news: [], sources: [], previous });
  assert.equal(anotherDay.movements[3].value, null);
});
test("archives deduplicate calendar dates and retain only the latest seven editions", () => {
  const rows = Array.from({ length: 9 }, (_, index) => edition(now - index * 86400000));
  const archive = mergeBriefArchives([{ version: 1, editions: rows }, { version: 1, editions: [rows[0]] }]);
  assert.equal(archive.editions.length, 7); assert.equal(archive.editions[0].date, "2026-11-20");
});
test("a change rounded to zero is not assigned a positive or negative market direction", () => {
  assert.equal(signedChange(-0.001), "0.00%"); assert.equal(signedChange(0), "0.00%"); assert.equal(signedChange(1), "+1.00%");
});

const nav = (date, value, change, extra = {}) => ({
  date, netvalue: value, totalnetvalue: value, dayinc: change, fundcode: "019442", ...extra,
});
const history = (...dataList) => parseWanjiaHistory({ dataList });

test("the fund uses exact adjacent disclosed unit NAVs, keeping a late or different-date NAV separate", () => {
  const prior = nav("2026-11-13", "1.2524", 0);
  const current = nav("2026-11-16", "1.2135", -3.11);
  const later = nav("2026-11-17", "1.3333", 9.87);
  const result = fundMovement(history(later, current, prior), current.date);
  assert.equal(result.unit, "元/份"); assert.equal(result.value, 1.2135); assert.equal(result.previousValue, 1.2524);
  assert.equal(result.previousDate, "2026-11-13"); assert.match(result.url, /wjasset/);
  assert.ok(Math.abs(result.change - (1.2135 / 1.2524 - 1) * 100) < 1e-12);
  const missing = fundMovement(history(later, prior), current.date);
  assert.equal(missing.value, null); assert.equal(missing.change, null);
  assert.deepEqual(missing.latestAvailable, { date: prior.date, value: 1.2524 });
});

test("the fund rejects the wrong share class, bad dates, distributions and missing intermediate observations", () => {
  const day = "2026-11-19", prior = nav("2026-11-17", "1.20", 1);
  const current = nav(day, "1.23", 2.5);
  assert.deepEqual(history({ ...current, fundcode: "019441" }, { ...current, date: "2026-02-30" }), []);
  for (const entries of [
    [prior, nav(day, "1.23", 2.5, { totalnetvalue: "1.3" })],
    [prior, nav(day, "1.23", 0)],
    [prior, nav("2026-11-18", "--", 0), current],
    [prior, nav("2026-11-18", "1.22", 0), nav("2026-11-18", "1.25", 0), current],
    [prior, nav(day, "1.23", "")],
  ]) {
    const result = fundMovement(history(...entries), day);
    assert.equal(result.value, 1.23); assert.equal(result.change, null);
    assert.equal(result.previousValue, undefined); assert.ok(result.comparisonNote);
  }
});

test("gold fund impact inputs use actual closes rather than backing out prices from rounded percentages", () => {
  const previous = { date: "2026-11-18", close: 810.79 }, current = { date: "2026-11-19", close: 801.93, change: -1.09 };
  const pair = goldComparison(current, [previous, current]);
  assert.equal(pair.previousValue, 810.79); assert.equal(pair.previousDate, previous.date);
  assert.ok(Math.abs(pair.change - (current.close / previous.close - 1) * 100) < 1e-12);
  assert.equal(goldComparison(current, [{ ...previous, close: 815.57 }]).previousValue, undefined);
  assert.equal(goldComparison(current, []).previousValue, undefined);
});

test("old four-movement reports and first-observed NAV times survive archive reads and provider outages", () => {
  const old = edition(); old.movements = old.movements.filter(m => m.id !== "fund");
  assert.equal(readBriefArchive({ version: 1, editions: [old] }, now).editions.length, 1);
  const input = { now, domestic: null, spot: [], nasdaq: [], dxy: [], sources: [], news: [],
    fundHistory: history(nav("2026-11-18", 1, 0), nav("2026-11-19", 1.02, 2)) };
  const first = buildMorningEdition(input);
  const next = buildMorningEdition({ ...input, now: now + 60000, fundHistory: [], previous: first });
  const move = next.movements.find(m => m.id === "fund");
  assert.equal(move.previousValue, 1); assert.equal(move.collectedAt, new Date(now).toISOString());
  assert.equal(readBriefArchive({ version: 1, editions: [next] }, now + 60000).editions.length, 1);
  for (const patch of [{ previousValue: 1.2 }, { date: "2026-11-18" }, { previousDate: next.reviewDate },
    { unit: "点" }, { url: "https://quote.eastmoney.com/gb/zsNDX.html" }]) {
    const copy = structuredClone(next); Object.assign(copy.movements.find(m => m.id === "fund"), patch);
    assert.equal(readBriefArchive({ version: 1, editions: [copy] }, now + 60000).editions.length, 0);
  }
});

test("a late NAV supplements the original issue and historical issues without moving the original news cutoff", () => {
  const options = { now, domestic: null, spot: [], nasdaq: [], dxy: [], sources: [], news: [] };
  const pending = buildMorningEdition(options);
  const navs = history(nav("2026-11-18", 1, 0), nav("2026-11-19", 1.02, 2));
  const late = now + 3600000, later = now + 86400000;
  const sameIssue = buildMorningEdition({ ...options, now: late, fundHistory: navs, previous: pending });
  assert.equal(sameIssue.generatedAt, pending.generatedAt); assert.equal(sameIssue.updatedAt, new Date(late).toISOString());
  assert.equal(sameIssue.movements.at(-1).supplementedAt, new Date(late).toISOString());
  const preserved = buildMorningEdition({ ...options, now: late + 60000, fundHistory: history(nav("2026-11-19", 1.02, 2)), previous: sameIssue });
  assert.equal(preserved.movements.at(-1).previousValue, 1);
  assert.equal(preserved.movements.at(-1).supplementedAt, new Date(late).toISOString());
  const original = { version: 1, editions: [pending] };
  const archive = supplementPastNavs(original, navs, later), archived = archive.editions[0];
  assert.equal(archived.generatedAt, pending.generatedAt); assert.equal(archived.cutoff, pending.cutoff);
  assert.deepEqual(archived.news, pending.news); assert.deepEqual(archived.analysis, pending.analysis);
  assert.equal(archived.movements.at(-1).supplementedAt, new Date(later).toISOString());
  assert.deepEqual(supplementPastNavs(archive, navs, later + 60000), archive);
  assert.deepEqual(mergeBriefArchives([original, archive]), archive);
  assert.deepEqual(readBriefArchive(archive, later), archive);
  const freshNarrative = { ...pending, generatedAt: new Date(late).toISOString(), overview: "更新的当日行情说明" };
  const recovered = mergeBriefArchives([archive, { version: 1, editions: [freshNarrative] }]).editions[0];
  assert.equal(recovered.overview, freshNarrative.overview); assert.equal(recovered.generatedAt, freshNarrative.generatedAt);
  assert.deepEqual(recovered.movements.at(-1), archived.movements.at(-1));
});

test("the fallback explicitly credits the fund distributor and refuses flagged events even at matching returns", () => {
  const raw = { ErrCode: 0, Data: { LSJZList: [
    { FSRQ: "2026-11-19", DWJZ: "1.02", LJJZ: "1.02", JZZZL: "2.00", FHFCBZ: "" },
    { FSRQ: "2026-11-18", DWJZ: "1.00", LJJZ: "1.00", JZZZL: "0.00", FHFCBZ: "" },
  ] } };
  const first = buildMorningEdition({ now, domestic: null, spot: [], nasdaq: [], dxy: [], news: [], sources: [],
    fundHistory: parseEastmoneyNavHistory(raw), fundProvider: "eastmoney" });
  const m = first.movements.at(-1);
  assert.equal(m.url, EASTMONEY_FUND_URL); assert.equal(m.previousValue, 1); assert.match(m.source, /天天基金/);
  assert.deepEqual(readBriefArchive({ version: 1, editions: [first] }, now).editions, [first]);
  raw.Data.LSJZList[0].FHFCBZ = "分红";
  assert.equal(fundMovement(parseEastmoneyNavHistory(raw), "2026-11-19", "eastmoney").previousValue, undefined);
});

test("later polling retains published headlines and the original issuance time", () => {
  const original = edition(), story = original.news[0];
  original.news = Array.from({ length: 6 }, (_, i) => ({ ...story, url: story.url + "?old=" + i }));
  const newer = buildMorningEdition({ now: now + 60000, domestic: null, spot: [], nasdaq: [], dxy: [], sources: [],
    news: Array.from({ length: 6 }, (_, i) => ({ ...story, url: story.url + "?new=" + i })), previous: original });
  assert.deepEqual(newer.news, original.news); assert.equal(newer.generatedAt, original.generatedAt);
});
