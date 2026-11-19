import { readFileSync, writeFileSync } from "node:fs";
import { buildMarket, normalizeIndexQuote } from "../lib/market.ts";

const local = normalizeIndexQuote(JSON.parse(readFileSync("public/market.json", "utf8")));
async function get(url, referer, raw = false) {
  const r = await fetch(url, { headers: { Referer: referer, "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw Error(`HTTP ${r.status}`);
  return raw ? r.text() : r.json();
}
const kline = id => `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${id}&klt=101&fqt=0&lmt=120&end=20500101&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55`;
const results = await Promise.allSettled([
  get("https://hyrose0704.github.io/qinglan-finance/market.json", "https://hyrose0704.github.io"),
  get("https://hq.sinajs.cn/list=hf_XAU,DINIW,hf_NQ,fx_susdcny", "https://finance.sina.com.cn", true),
  get(kline("101.GC00Y"), "https://quote.eastmoney.com"),
  get(kline("100.NDX"), "https://quote.eastmoney.com"),
  get("https://api.fund.eastmoney.com/f10/lsjz?fundCode=019442&pageIndex=1&pageSize=30", "https://fundf10.eastmoney.com/"),
]);
const value = (i, other = null) => results[i].status === "fulfilled" ? results[i].value : other;
const previous = value(0);
const fallback = previous?.quotes?.length && Date.parse(previous.fetchedAt) > Date.parse(local.fetchedAt) && Date.parse(previous.fetchedAt) <= Date.now() + 60000 ? previous : local;
const data = buildMarket({ sina: value(1, ""), gold: value(2), nasdaq: value(3), fund: value(4), fetchedAt: new Date().toISOString() });
if (data.quotes.length) {
  data.mode = "snapshot"; data.snapshotAt = data.fetchedAt;
  data.histories.gold = data.histories.gold.length ? data.histories.gold : fallback.histories.gold;
  data.histories.nasdaq = data.histories.nasdaq.length ? data.histories.nasdaq : fallback.histories.nasdaq;
  data.fund ??= fallback.fund;
  writeFileSync("public/market.json", JSON.stringify(normalizeIndexQuote(data)));
  console.log(`Market snapshot updated: ${data.quotes.length} quotes; NAV date ${data.fund?.date || "unavailable"}.`);
} else {
  writeFileSync("public/market.json", JSON.stringify({ ...fallback, mode: "snapshot", errors: ["定时采集暂不可用，保留上次有效快照"] }));
  console.warn("Market sources unavailable. Previous dated snapshot retained; no synthetic prices generated.");
}
