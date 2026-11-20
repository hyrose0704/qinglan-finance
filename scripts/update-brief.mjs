import { readFileSync, writeFileSync } from "node:fs";
import { BRIEF_SOURCES, morningWindow, parseMorningFeed, buildMorningEdition, readBriefArchive, mergeBriefArchives, supplementPastNavs } from "../lib/morning-brief.ts";
import { readDomesticGold, parseSgeDaily, shiftDay, SGE_DAILY_URL } from "../lib/domestic-gold.ts";
import { FUND_DISCLOSURE_URL, FUND_HISTORY_URL, EASTMONEY_FUND_URL, parseWanjiaHistory, parseEastmoneyNavHistory } from "../lib/brief-prices.ts";
import { parseKline } from "../lib/market.ts";

const now = Date.now(), window = morningWindow(now);
async function get(url, text = false) {
  const market = url.startsWith("https://push2");
  for (let attempt = 0; attempt < (market ? 2 : 1); attempt++) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": market ? "Mozilla/5.0" : "QinglanFinance/1.0 (public market morning brief)",
        Referer: url.startsWith(FUND_HISTORY_URL) ? FUND_DISCLOSURE_URL : url.startsWith("https://api.fund.eastmoney.com/") ? EASTMONEY_FUND_URL
          : market ? "https://quote.eastmoney.com/" : new URL(url).origin + "/" },
        redirect: "error", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      return text ? await response.text() : await response.json();
    } catch (error) { if (!market || attempt === 1 || !["TypeError", "TimeoutError"].includes(error.name)) throw error; }
  }
}
let local = null, published = null;
try { local = readBriefArchive(JSON.parse(readFileSync("public/brief.json", "utf8")), now); } catch {}
try { published = readBriefArchive(await get("https://hyrose0704.github.io/qinglan-finance/brief.json"), now); } catch {}
const archive = mergeBriefArchives([local, published]), old = archive.editions.find(row => row.date === window.date);
const usable = edition => edition?.movements.length === 5 && edition.movements.every(row =>
  row.value !== null && row.change !== null && (!["domestic", "fund"].includes(row.id) || row.previousValue > 0)) && edition.news.length > 0;
const refreshIssue = !usable(old) || process.argv.includes("--force");
const incompleteHistory = archive.editions.some(row => row.date < window.date && !row.movements.some(m => m.id === "fund" && m.previousValue > 0));
const start = shiftDay(window.reviewDate, -32);
const fundQuery = new URLSearchParams({ fundcode: "019442", from: start, to: window.reviewDate, pages: "1-30" });
async function disclosedNavs() {
  let rows = [];
  try { rows = parseWanjiaHistory(await get(`${FUND_HISTORY_URL}?${fundQuery}`)); } catch { /* Try a dated public distributor series. */ }
  if (rows.some(row => row.value !== null)) return { rows, provider: "wanjia" };
  try {
    rows = parseEastmoneyNavHistory(await get("https://api.fund.eastmoney.com/f10/lsjz?fundCode=019442&pageIndex=1&pageSize=30"));
  } catch { /* Keep a previously verified close or show missing data. */ }
  return { rows, provider: rows.length ? "eastmoney" : "wanjia" };
}
const navRequest = refreshIssue || incompleteHistory ? disclosedNavs() : Promise.resolve({ rows: [], provider: "wanjia" });
if (refreshIssue) {
  const history = id => `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${id}&klt=101&fqt=0&lmt=15&end=20500101&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55`;
  const sge = end => `${SGE_DAILY_URL}?start_date=${start}&end_date=${end}`;
  const results = await Promise.allSettled([
    ...BRIEF_SOURCES.map(source => get(source.feed, true)), get(history("122.XAU")), get(history("100.UDI")),
    get(sge(window.reviewDate), true), get(sge(shiftDay(window.reviewDate, -1)), true),
  ]);
  const value = index => results[index].status === "fulfilled" ? results[index].value : null;
  const news = BRIEF_SOURCES.flatMap((source, index) => parseMorningFeed(value(index) || "", source.id, now));
  const sources = BRIEF_SOURCES.map((source, index) => {
    const fetched = results[index].status === "fulfilled" && /<rss\b|<channel\b/i.test(value(index));
    return { id: source.id, status: fetched ? "fetched" : "unavailable", checkedAt: fetched ? new Date(now).toISOString() : null,
      count: news.filter(item => item.sourceId === source.id).length };
  });
  let market = null;
  try { market = JSON.parse(readFileSync("public/market.json", "utf8")); } catch {}
  const domesticHistory = [...parseSgeDaily(value(6) || "", now), ...parseSgeDaily(value(5) || "", now)];
  const navs = await navRequest;
  const edition = buildMorningEdition({ now, observedAt: Date.now(), domestic: readDomesticGold(market?.domesticGold, now),
    domesticHistory, fundHistory: navs.rows, fundProvider: navs.provider, spot: parseKline(value(3)), goldFallback: market?.histories?.gold || [],
    dxy: parseKline(value(4)), nasdaq: market?.histories?.nasdaq || [], news, sources, previous: old });
  const score = row => row.movements.filter(m => m.value !== null && m.change !== null).length * 10 + row.news.length;
  const marketChanges = item => JSON.stringify(item.movements.map(({ id, name, value, change, previousDate, previousValue, latestAvailable, comparisonNote }) =>
    [id, name, value, change, previousDate, previousValue, latestAvailable, comparisonNote]));
  if (!old || marketChanges(old) !== marketChanges(edition) || score(edition) > score(old) || process.argv.includes("--force")) {
    archive.editions = [edition, ...archive.editions.filter(row => row.date !== edition.date)].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  }
}
const navs = await navRequest;
const checkedAt = Date.now();
const supplemented = supplementPastNavs(archive, navs.rows, checkedAt, navs.provider);
const checked = readBriefArchive(supplemented, checkedAt);
if (!checked?.editions.length || checked.editions.length !== archive.editions.length) throw Error("Morning brief validation failed; no report was written.");
writeFileSync("public/brief.json", JSON.stringify(checked));
console.log(`Morning brief: ${checked.editions[0].date}; ${checked.editions[0].news.length} cited headlines; original news cutoff preserved.`);
