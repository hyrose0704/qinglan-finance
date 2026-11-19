export interface Quote {
  id: string;
  name: string;
  symbol: string;
  value: number;
  change: number;
  unit: string;
  asOf: string | null;
  source: string;
  sourceUrl: string;
}
export interface Point { date: string; value: number }
export interface Market {
  mode: "online" | "partial" | "snapshot" | "unavailable";
  fetchedAt: string;
  snapshotAt?: string;
  quotes: Quote[];
  histories: { gold: Point[]; nasdaq: Point[] };
  fund: { nav: number; date: string; change: number; buyStatus: string; sellStatus: string; history: Point[] } | null;
  errors: string[];
}

function valid(v: unknown): number | null {
  const n = Number(v);
  return v !== "" && v !== null && v !== undefined && Number.isFinite(n) && n > 0 ? n : null;
}

function stamp(date?: string, time?: string): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !time || !/^\d{2}:\d{2}:\d{2}$/.test(time)) return null;
  const result = `${date}T${time}+08:00`;
  return Number.isFinite(Date.parse(result)) ? result : null;
}

export function parseSina(text: string): Quote[] {
  const rows: Record<string, string[]> = {};
  for (const line of text.split(";")) {
    const match = line.match(/hq_str_(\w+)="([^"]*)"/);
    if (match) rows[match[1]] = match[2].split(",");
  }
  const output: Quote[] = [];
  for (const spec of [
    { code: "hf_XAU", id: "gold", name: "国际现货黄金", symbol: "XAU / USD", unit: "美元 / 盎司", last: 0, previous: 7, time: 6, date: 12 },
    { code: "hf_NQ", id: "nasdaq", name: "纳指100期货", symbol: "NASDAQ 100 · FUTURES", unit: "点", last: 0, previous: 7, time: 6, date: 12 },
    { code: "DINIW", id: "dxy", name: "美元指数", symbol: "DXY", unit: "点", last: 1, previous: 3, time: 0, date: 10 },
    { code: "fx_susdcny", id: "fx", name: "美元兑人民币", symbol: "USD / CNY", unit: "人民币 / 美元", last: 1, previous: 3, time: 0, date: 17 },
  ]) {
    const f = rows[spec.code];
    if (!f) continue;
    const value = valid(f[spec.last]);
    const previous = valid(f[spec.previous]);
    if (value === null || previous === null) continue;
    output.push({ id: spec.id, name: spec.name, symbol: spec.symbol, value, change: (value / previous - 1) * 100, unit: spec.unit,
      asOf: stamp(f[spec.date], f[spec.time]), source: "新浪财经", sourceUrl: spec.id === "fx" ? "https://finance.sina.com.cn/money/forex/hq/USDCNY.shtml" : "https://finance.sina.com.cn/futures/quotes/" + spec.code + ".shtml" });
  }
  return output;
}

export function parseKline(data: unknown): Point[] {
  const rows = (data as { data?: { klines?: unknown[] } })?.data?.klines;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap(row => {
    if (typeof row !== "string") return [];
    const p = row.split(",");
    const value = valid(p[2]);
    return value && /^\d{4}-\d{2}-\d{2}$/.test(p[0]) ? [{ date: p[0], value }] : [];
  });
}

export function parseFund(data: unknown): Market["fund"] {
  const rows = (data as { Data?: { LSJZList?: { FSRQ: string; DWJZ: string; JZZZL: string; SGZT: string; SHZT: string }[] } })?.Data?.LSJZList;
  if (!Array.isArray(rows)) return null;
  const entries = rows.filter(x => valid(x.DWJZ) && /^\d{4}-\d{2}-\d{2}$/.test(x.FSRQ)).sort((a, b) => b.FSRQ.localeCompare(a.FSRQ));
  if (!entries.length) return null;
  const first = entries[0];
  return { nav: Number(first.DWJZ), date: first.FSRQ, change: Number(first.JZZZL) || 0, buyStatus: first.SGZT || "状态未提供", sellStatus: first.SHZT || "状态未提供", history: entries.map(x => ({ date: x.FSRQ, value: Number(x.DWJZ) })).reverse() };
}

export function buildMarket(raw: { sina: string; gold: unknown; nasdaq: unknown; fund: unknown; fetchedAt: string }): Market {
  return { mode: "online", fetchedAt: raw.fetchedAt, quotes: parseSina(raw.sina), histories: { gold: parseKline(raw.gold), nasdaq: parseKline(raw.nasdaq) }, fund: parseFund(raw.fund), errors: [] };
}

export function normalizeIndexQuote(market: Market): Market {
  const rows = market.histories.nasdaq;
  const last = rows.at(-1), previous = rows.at(-2);
  const quotes = market.quotes.filter(q => q.id !== "nasdaq");
  if (last && previous && previous.value > 0) quotes.push({
    id: "nasdaq", name: "纳斯达克100指数", symbol: "NASDAQ 100 INDEX", unit: "点",
    value: last.value, change: (last.value / previous.value - 1) * 100,
    asOf: null, source: `东方财富 · 日线 ${last.date}`, sourceUrl: "https://quote.eastmoney.com/gb/zsNDX.html",
  });
  return { ...market, quotes };
}
