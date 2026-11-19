import { parseKline, normalizeIndexQuote, type Market, type Quote } from "./market";

const QUOTES = "https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=122.XAU,100.NDX,100.UDI&fields=f2,f3,f12,f14,f124";
async function json(url: string) {
  const r = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(7000), cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
function parseQuotes(data: { data?: { diff?: { f2: number; f3: number; f12: string; f124: number }[] } }): Quote[] {
  const rows = data?.data?.diff;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap(q => {
    const spec = q.f12 === "XAU" ? { id: "gold", name: "国际现货黄金", symbol: "XAU / USD", unit: "美元 / 盎司" } : q.f12 === "NDX" ? { id: "nasdaq", name: "纳斯达克100指数", symbol: "NASDAQ 100 INDEX", unit: "点" } : q.f12 === "UDI" ? { id: "dxy", name: "美元指数", symbol: "DXY", unit: "点" } : null;
    if (!spec || typeof q.f2 !== "number" || !Number.isFinite(q.f2) || q.f2 <= 0 || !Number.isFinite(q.f3)) return [];
    const asOf = typeof q.f124 === "number" && q.f124 > 0 ? new Date(q.f124 * 1000).toISOString() : null;
    return [{ ...spec, value: q.f2, change: q.f3, asOf, source: "东方财富 · 在线获取", sourceUrl: "https://quote.eastmoney.com/" }];
  });
}

export async function loadMarket(): Promise<Market> {
  const historyUrl = (id: string) => `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${id}&klt=101&fqt=0&lmt=120&end=20500101&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55`;
  const results = await Promise.allSettled([
    json(`${import.meta.env.BASE_URL}market.json?t=${Math.floor(Date.now() / 60000)}`),
    json(QUOTES), json(historyUrl("101.GC00Y")), json(historyUrl("100.NDX")),
  ]);
  const value = (i: number) => results[i].status === "fulfilled" ? (results[i] as PromiseFulfilledResult<unknown>).value : null;
  const rawFallback = value(0) as Market | null;
  const fallback = rawFallback?.quotes && rawFallback.histories ? normalizeIndexQuote(rawFallback) : null;
  const quotes = parseQuotes(value(1) as Parameters<typeof parseQuotes>[0]);
  const gold = parseKline(value(2)), nasdaq = parseKline(value(3));
  if (!quotes.length) {
    if (!fallback?.quotes?.length) throw new Error("No market data available");
    return { ...fallback, mode: "snapshot", snapshotAt: fallback.snapshotAt || fallback.fetchedAt, errors: ["浏览器未能连接在线报价，已显示标明时间的备用数据"] };
  }
  const fx = fallback?.quotes?.find(q => q.id === "fx");
  const output: Market = {
    mode: "partial", fetchedAt: new Date().toISOString(),
    quotes: [...quotes, ...(fx ? [{ ...fx, source: "新浪财经 · 定时采集" }] : [])],
    histories: { gold: gold.length ? gold : fallback?.histories?.gold || [], nasdaq: nasdaq.length ? nasdaq : fallback?.histories?.nasdaq || [] },
    fund: fallback?.fund || null,
    errors: [],
  };
  if (fx && output.fund && gold.length && nasdaq.length && quotes.length === 3) output.mode = "online";
  if (!fx) output.errors.push("美元人民币汇率等待定时采集，黄金人民币估值使用手动报价");
  if (!output.fund) output.errors.push("基金净值暂无可用数据");
  return output;
}
