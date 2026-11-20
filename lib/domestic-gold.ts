export const SGE_DELAYED_URL = "https://www.sge.com.cn/sjzx/yshqbg";
export const SGE_DAILY_URL = "https://www.sge.com.cn/sjzx/quotation_daily_new";
export interface DomesticGoldDay {
  date: string; open: number; high: number; low: number; close: number; change: number | null;
}
export interface DomesticGoldQuote {
  date: string; price: number; open: number; high: number; low: number; kind: "delayed" | "close";
}
export interface DomesticGold {
  quote: DomesticGoldQuote | null; daily: DomesticGoldDay[]; collectedAt: string | null; cached: boolean;
}

export function beijingDay(now: number): string { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }
export function shiftDay(day: string, amount: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);
}
function validDay(value: unknown, now: number): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value && value <= beijingDay(now);
}
function numeric(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && (!value.trim() || !/^[+-]?[\d,.]+%?$/.test(value.trim()))) return null;
  const result = Number(String(value).replace(/[,％%]/g, ""));
  return Number.isFinite(result) ? result : null;
}
function cells(row: string): string[] {
  return [...row.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(match => match[1].replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim());
}
function prices(open: unknown, high: unknown, low: unknown, close: unknown) {
  const numbers = [open, high, low, close].map(numeric);
  if (numbers.some(value => value === null || value <= 0)) return null;
  const [o, h, l, c] = numbers as number[];
  return h >= l && o >= l && o <= h && c >= l && c <= h ? { open: o, high: h, low: l, close: c } : null;
}
export function parseSgeDaily(html: string, now: number): DomesticGoldDay[] {
  if (html.length > 2000000) return [];
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(match => {
    const row = cells(match[1]);
    if (row[1] !== "Au99.99" || !validDay(row[0], now)) return [];
    const values = prices(row[2], row[3], row[4], row[5]); if (!values) return [];
    const change = numeric(row[7]), absolute = numeric(row[6]);
    if (change !== null && (change < -100 || change > 100)) return [];
    if (change !== null && absolute !== null && (values.close - absolute <= 0
      || Math.abs((values.close / (values.close - absolute) - 1) * 100 - change) > 0.08)) return [];
    return [{ date: row[0], ...values, change }];
  }).sort((a, b) => a.date.localeCompare(b.date));
}
export function parseSgeDelayed(html: string, now: number): DomesticGoldQuote | null {
  if (html.length > 1000000) return null;
  const heading = html.match(/<h1\b[^>]*>\s*上海黄金交易所(\d{4})年(\d{1,2})月(\d{1,2})日延时行情\s*<\/h1>/);
  if (!heading) return null;
  const date = `${heading[1]}-${heading[2].padStart(2, "0")}-${heading[3].padStart(2, "0")}`;
  if (!validDay(date, now)) return null;
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = cells(match[1]); if (row[0] !== "Au99.99") continue;
    const values = prices(row[4], row[2], row[3], row[1]);
    if (values) return { date, price: values.close, open: values.open, high: values.high, low: values.low, kind: "delayed" };
  }
  return null;
}
export function readDomesticGold(value: unknown, now: number): DomesticGold | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<DomesticGold>, time = Date.parse(raw.collectedAt || "");
  if (!Number.isFinite(time) || time > now + 60000 || !Array.isArray(raw.daily)) return null;
  const daily = raw.daily.flatMap(day => {
    if (!day || !validDay(day.date, now)) return [];
    const values = prices(day.open, day.high, day.low, day.close); if (!values) return [];
    const change = numeric(day.change);
    return [{ date: day.date, ...values, change: change !== null && Math.abs(change) <= 100 ? change : null }];
  }).sort((a, b) => a.date.localeCompare(b.date)).slice(-20);
  const q = raw.quote, values = q ? prices(q.open, q.high, q.low, q.price) : null;
  const quote = q && validDay(q.date, now) && values && ["delayed", "close"].includes(q.kind)
    ? { date: q.date, price: values.close, open: values.open, high: values.high, low: values.low, kind: q.kind } : null;
  return { quote, daily, collectedAt: new Date(time).toISOString(), cached: raw.cached === true };
}
export function collectDomesticGold(delayed: string, history: string, now: number, previous: unknown): DomesticGold {
  const old = readDomesticGold(previous, now), parsedDaily = parseSgeDaily(history, now), delayedQuote = parseSgeDelayed(delayed, now);
  const merged = new Map((old?.daily || []).map(row => [row.date, row]));
  parsedDaily.forEach(row => merged.set(row.date, row));
  const daily = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-20), last = parsedDaily.at(-1);
  const closingQuote: DomesticGoldQuote | null = last ? { date: last.date, price: last.close, open: last.open, high: last.high, low: last.low, kind: "close" } : null;
  const quote = delayedQuote && (!closingQuote || delayedQuote.date >= closingQuote.date) ? delayedQuote : closingQuote;
  if (old?.quote && (!quote || old.quote.date > quote.date)) return { ...old, daily, cached: true };
  return quote ? { quote, daily, collectedAt: new Date(now).toISOString(), cached: false }
    : { quote: old?.quote || null, daily, collectedAt: old?.collectedAt || null, cached: true };
}
export function domesticGoldChange(snapshot: DomesticGold): number | null {
  const q = snapshot.quote; if (!q) return null;
  if (q.kind === "close") return snapshot.daily.find(row => row.date === q.date)?.change ?? null;
  const previous = snapshot.daily.filter(row => row.date < q.date).at(-1);
  return previous && Date.parse(q.date) - Date.parse(previous.date) <= 10 * 86400000 ? (q.price / previous.close - 1) * 100 : null;
}
