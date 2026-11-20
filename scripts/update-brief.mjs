import { readFileSync, writeFileSync } from "node:fs";
import { BRIEF_SOURCES, morningWindow, parseMorningFeed, buildMorningEdition, readBriefArchive, mergeBriefArchives } from "../lib/morning-brief.ts";
import { readDomesticGold } from "../lib/domestic-gold.ts";
import { parseKline } from "../lib/market.ts";

const now = Date.now(), window = morningWindow(now);
async function get(url, text = false) {
  const market = url.startsWith("https://push2");
  for (let attempt = 0; attempt < (market ? 2 : 1); attempt++) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": market ? "Mozilla/5.0" : "QinglanFinance/1.0 (public market morning brief)",
        Referer: "https://quote.eastmoney.com/" }, redirect: "error", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      return text ? await response.text() : await response.json();
    } catch (error) { if (!market || attempt === 1 || !["TypeError", "TimeoutError"].includes(error.name)) throw error; }
  }
}
let local = null, published = null;
try { local = readBriefArchive(JSON.parse(readFileSync("public/brief.json", "utf8")), now); } catch {}
try { published = readBriefArchive(await get("https://hyrose0704.github.io/qinglan-finance/brief.json"), now); } catch {}
const archive = mergeBriefArchives([local, published]), old = archive.editions.find(row => row.date === window.date);
const usable = edition => edition && edition.movements.every(row => row.value !== null && row.change !== null) && edition.news.length > 0;
if (usable(old) && !process.argv.includes("--force")) {
  writeFileSync("public/brief.json", JSON.stringify(archive));
  console.log(`Morning brief retained: ${old.date}; original collection time preserved.`);
} else {
  const history = id => `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${id}&klt=101&fqt=0&lmt=15&end=20500101&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55`;
  const results = await Promise.allSettled([
    ...BRIEF_SOURCES.map(source => get(source.feed, true)), get(history("122.XAU")), get(history("100.UDI")),
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
  const edition = buildMorningEdition({ now, domestic: readDomesticGold(market?.domesticGold, now),
    spot: parseKline(value(3)), goldFallback: market?.histories?.gold || [], dxy: parseKline(value(4)), nasdaq: market?.histories?.nasdaq || [], news, sources, previous: old });
  const score = row => row.movements.filter(m => m.value !== null && m.change !== null).length * 10 + row.news.length;
  if (!old || score(edition) > score(old) || process.argv.includes("--force")) {
    archive.editions = [edition, ...archive.editions.filter(row => row.date !== edition.date)].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  }
  const checked = readBriefArchive(archive, now);
  if (!checked || !checked.editions.length) throw Error("Morning brief validation failed; no report was written.");
  writeFileSync("public/brief.json", JSON.stringify(checked));
  console.log(`Morning brief: ${checked.editions[0].date}; ${checked.editions[0].news.length} cited headlines; missing evidence remains labeled.`);
}
