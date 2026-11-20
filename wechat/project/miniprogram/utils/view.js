const {
  briefHoldingsImpact, calculate, interpretMorningEdition, readDomesticGold, quoteFresh, signedChange, BRIEF_SOURCES,
} = require("./shared.js");

function number(value, places = 2) {
  if (!Number.isFinite(value)) return "待补";
  const [integer, decimals] = value.toFixed(places).split(".");
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (decimals ? "." + decimals : "");
}

function quantity(value) {
  if (!Number.isFinite(value)) return "待填写";
  return value.toFixed(10).replace(/\.?0+$/, "");
}

function signedMoney(value) {
  const sign = Math.abs(value) < 0.005 ? "" : value < 0 ? "−" : "+";
  return sign + "¥" + number(Math.abs(value));
}

function cny(value, privacy) { return privacy ? "••••" : "¥" + number(value); }
function color(change) { return change > 0.004999 ? "up" : change < -0.004999 ? "down" : "neutral"; }
function beijingTime(stamp) {
  const time = Date.parse(stamp);
  return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 16).replace("T", " ") : "";
}

function availablePrices(market, now = Date.now()) {
  const gold = market?.quotes.find(row => row?.id === "gold"), fx = market?.quotes.find(row => row?.id === "fx");
  const recentPair = quoteFresh(gold?.asOf, now) && quoteFresh(fx?.asOf, now)
    && Math.abs(Date.parse(gold.asOf) - Date.parse(fx.asOf)) <= 300000
    && Number.isFinite(gold.value) && gold.value > 0 && Number.isFinite(fx.value) && fx.value > 0;
  const nav = market?.fund;
  const day = nav && typeof nav.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(nav.date) ? Date.parse(nav.date + "T00:00:00+08:00") : NaN;
  const navFresh = Number.isFinite(day) && day <= now && now - day <= 10 * 86400000 && Number.isFinite(nav.nav) && nav.nav > 0;
  return { gold: recentPair ? gold.value * fx.value / 31.1034768 : null, fund: navFresh ? nav.nav : null };
}

function balancesFor(profile, market) {
  const prices = availablePrices(market);
  return { balances: calculate(profile, prices), prices };
}

function snapshotCards(market) {
  if (!market) return [];
  const domestic = readDomesticGold(market.domesticGold, Date.now());
  const cards = [];
  const quote = domestic?.quote, daily = domestic?.daily.at(-1);
  if (quote || daily) {
    const change = daily?.date === quote?.date || !quote ? daily?.change : null;
    cards.push({
      id: "sge", label: "国内现货金 Au99.99", value: number(quote?.price ?? daily?.close), unit: "元/克",
      change: change == null ? "" : signedChange(change), tone: color(change), date: quote?.date ?? daily?.date,
      source: "上海黄金交易所 · " + (quote?.kind === "delayed" ? "延时行情" : "收盘"),
      url: quote?.kind === "delayed" ? "https://www.sge.com.cn/sjzx/yshqbg" : "https://www.sge.com.cn/sjzx/quotation_daily_new",
    });
  }
  for (const row of market.quotes) {
    if (!row || !["gold", "nasdaq", "fx", "dxy"].includes(row.id) || !Number.isFinite(row.value)) continue;
    cards.push({
      id: row.id, label: row.name, value: number(row.value, row.id === "fx" ? 4 : 2), unit: row.unit,
      change: Number.isFinite(row.change) ? signedChange(row.change) : "", tone: color(row.change),
      date: beijingTime(row.asOf) || "采集 " + beijingTime(market.fetchedAt), source: row.source, url: row.sourceUrl,
    });
  }
  if (market.fund?.nav > 0 && typeof market.fund.date === "string") {
    cards.push({
      id: "fund", label: "万家纳指100 C · 019442", value: number(market.fund.nav, 4), unit: "元/份",
      change: "", tone: "neutral", date: "净值日 " + market.fund.date,
      source: "天天基金 · 已公布净值", url: "https://fundf10.eastmoney.com/jjjz_019442.html",
    });
  }
  return cards;
}

function editionView(edition, profile, privacy) {
  const impact = privacy ? null : briefHoldingsImpact(profile, edition);
  let analysis;
  try { analysis = interpretMorningEdition(edition); } catch {
    analysis = edition.analysis.map((row, index) => ({
      asset: "archived-" + index, title: row.title, possibleReason: row.text, watch: "",
      observation: "", counterEvidence: "", sources: row.references.map(url => ({ title: "原始报道", url })),
    }));
  }
  function quote(id) {
    const move = edition.movements.find(row => row.id === id);
    if (!move) return { id, name: "万家纳指100 C · 019442", value: "未收录" };
    const digits = id === "fund" ? 4 : 2;
    const unitChange = move.value === null || move.previousValue === undefined ? null : move.value - move.previousValue;
    const delta = unitChange === null ? "" : (unitChange > 0 ? "+" : unitChange < 0 ? "−" : "") + number(Math.abs(unitChange), digits) + " " + move.unit;
    return {
      ...move,
      value: move.value !== null ? number(move.value, digits) : id === "fund" ? "净值待补" : "收盘待补",
      unit: move.value === null ? "" : move.unit, delta, change: move.change === null ? "" : signedChange(move.change),
      tone: color(move.change),
      compare: move.previousDate ? move.previousDate + " → " + edition.reviewDate : edition.reviewDate,
      latest: move.latestAvailable ? "最近可核验 " + move.latestAvailable.date + " · " + number(move.latestAvailable.value, digits) + " " + move.unit : "",
      supplemented: move.supplementedAt ? "补录 " + beijingTime(move.supplementedAt) : "",
    };
  }
  return {
    date: edition.date, reviewDate: edition.reviewDate, cutoff: beijingTime(edition.cutoff), generatedAt: beijingTime(edition.generatedAt),
    updatedAt: edition.updatedAt ? beijingTime(edition.updatedAt) : "", gapCount: edition.gaps.length,
    primary: ["domestic", "nasdaq", "fund"].map(quote), context: ["gold", "dxy"].map(quote),
    gaps: edition.gaps, analysis, news: edition.news.map(item => ({
      ...item, stamp: beijingTime(item.publishedAt), issuer: BRIEF_SOURCES.find(source => source.id === item.sourceId)?.name || "",
    })),
    impact: impact && {
      rows: impact.rows.map(row => ({
        ...row, amount: row.amount === null ? row.state === "missing-price" ? "待补行情" : "待填写" : signedMoney(row.amount),
        quantity: row.quantity === null ? "" : quantity(row.quantity) + " " + row.unit,
        perUnit: row.state === "estimated" ? "(" + (row.unitChange < 0 ? "−" : row.unitChange > 0 ? "+" : "")
          + number(Math.abs(row.unitChange), row.id === "fund" ? 4 : 2) + " 元/" + row.unit + ")" : "",
        tone: row.amount === null ? "neutral" : color(row.amount),
      })),
      amount: impact.total !== null ? signedMoney(impact.total) : impact.subtotal !== null ? signedMoney(impact.subtotal) : "",
      subtotal: impact.subtotal !== null,
    },
  };
}

module.exports = { number, quantity, cny, signedMoney, beijingTime, balancesFor, snapshotCards, editionView };
