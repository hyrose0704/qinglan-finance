import type { BriefMovement } from "./morning-brief.ts";
import type { DomesticGoldDay } from "./domestic-gold.ts";

export const FUND_DISCLOSURE_URL = "https://www.wjasset.com/products/qdii/019442/index.html";
export const FUND_HISTORY_URL = "https://www.wjasset.com/common-web/chart/fundnettable/getFundNetTableJson";
export const EASTMONEY_FUND_URL = "https://fundf10.eastmoney.com/jjjz_019442.html";
export type NavProvider = "wanjia" | "eastmoney";
export const MISSING_NAV_COMPARISON = "缺少相邻披露日的完整比较数据。";

export interface NavObservation {
  date: string;
  value: number | null;
  cumulative: number | null;
  reportedChange: number | null;
  adjustment?: boolean;
}

export function isCalendarDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function decimal(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^[+-]?\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positive(value: unknown): number | null {
  const n = decimal(value);
  return n !== null && n > 0 ? n : null;
}

function orderedNavs(observations: NavObservation[]): NavObservation[] {
  const dates = new Map<string, NavObservation>();
  for (const entry of observations) {
    const old = dates.get(entry.date);
    // A conflicting or incomplete dated observation must not be skipped to reach an older NAV.
    if (old && (old.value !== entry.value || old.cumulative !== entry.cumulative || old.reportedChange !== entry.reportedChange || old.adjustment !== entry.adjustment)) {
      dates.set(entry.date, { date: entry.date, value: null, cumulative: null, reportedChange: null });
    } else dates.set(entry.date, entry);
  }
  return [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function parseWanjiaHistory(data: unknown): NavObservation[] {
  const list = (data as { dataList?: unknown })?.dataList;
  if (!Array.isArray(list)) return [];
  return orderedNavs(list.filter(row => row?.fundcode === "019442" && isCalendarDay(row.date)).map(row => ({
    date: row.date, value: positive(row.netvalue), cumulative: positive(row.totalnetvalue),
    reportedChange: decimal(row.dayinc), adjustment: /分红|拆分|折算/.test(String(row.remak || "")),
  })));
}

export function parseEastmoneyNavHistory(data: unknown): NavObservation[] {
  const response = data as { ErrCode?: number; Data?: { LSJZList?: unknown } };
  const list = response?.Data?.LSJZList;
  if (response?.ErrCode !== 0 || !Array.isArray(list)) return [];
  return orderedNavs(list.filter(row => row && isCalendarDay(row.FSRQ)).map(row => ({
    date: row.FSRQ, value: positive(row.DWJZ), cumulative: positive(row.LJJZ), reportedChange: decimal(row.JZZZL),
    adjustment: [row.FHFCZ, row.FHFCZ10, row.FHFCBZ, row.FHSP].some(field => field != null && String(field).trim() !== "" && Number(field) !== 0),
  })));
}

export function fundMovement(history: NavObservation[], day: string, provider: NavProvider = "wanjia"): BriefMovement {
  const move: BriefMovement = { id: "fund", name: "万家纳指100 C · 019442", unit: "元/份",
    source: provider === "wanjia" ? "万家基金 · 公布单位净值" : "天天基金 · 历史单位净值",
    url: provider === "wanjia" ? FUND_DISCLOSURE_URL : EASTMONEY_FUND_URL, value: null, date: null, change: null };
  const current = history.find(row => row.date === day);
  const previous = history.filter(row => row.date < day).at(-1);
  if (!current?.value) {
    const latest = history.filter(row => row.date < day && row.value !== null).at(-1);
    if (latest?.value) move.latestAvailable = { date: latest.date, value: latest.value };
    move.comparisonNote = "尚未取得复盘日的公布净值，可能尚待披露或当天没有净值。";
    return move;
  }
  move.value = current.value;
  move.date = current.date;
  if (!previous?.value || current.reportedChange === null || current.cumulative === null || previous.cumulative === null) {
    move.comparisonNote = MISSING_NAV_COMPARISON;
    return move;
  }
  const change = (current.value / previous.value - 1) * 100;
  const distribution = (current.cumulative - current.value) - (previous.cumulative - previous.value);
  if (current.adjustment || Math.abs(distribution) >= 0.00009 || Math.abs(change - current.reportedChange) > 0.011) {
    move.comparisonNote = "单位净值差与累计净值或公布涨幅口径未对齐，需核对分红、折算或净值更正。";
    return move;
  }
  return { ...move, previousValue: previous.value, previousDate: previous.date, change };
}

export function goldComparison(current: DomesticGoldDay, history: DomesticGoldDay[]): Partial<BriefMovement> {
  const previous = history.filter(row => row.date < current.date).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  if (previous && current.change !== null && previous.close > 0) {
    const change = (current.close / previous.close - 1) * 100;
    if (Math.abs(change - current.change) <= 0.011) {
      return { previousValue: previous.close, previousDate: previous.date, change };
    }
  }
  return { comparisonNote: "交易所公布的涨跌幅可供参考，上期收盘对照尚待核实。" };
}
