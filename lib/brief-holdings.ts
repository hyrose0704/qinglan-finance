import type { Profile } from "./finance.ts";
import type { MorningEdition } from "./morning-brief.ts";
import { isCalendarDay } from "./brief-prices.ts";

type HoldingState = "estimated" | "zero" | "missing-quantity" | "missing-price";
export interface BriefHoldingImpact {
  id: "domestic" | "fund";
  name: string;
  unit: "克" | "份";
  quantity: number | null;
  state: HoldingState;
  amount: number | null;
  unitChange: number | null;
  previousDate: string | null;
  note: string;
}

const holdings = [
  { id: "domestic", name: "国内黄金 Au99.99", field: "goldGrams", unit: "克", priceUnit: "元/克" },
  { id: "fund", name: "万家纳指100 C（019442）", field: "fundUnits", unit: "份", priceUnit: "元/份" },
] as const;

function holdingImpact(profile: Profile, edition: MorningEdition, holding: (typeof holdings)[number]): BriefHoldingImpact {
  const { id, name, field, unit, priceUnit } = holding;
  const movement = edition.movements.find(row => row.id === id && row.unit === priceUnit);
  const price = movement?.value, prior = movement?.previousValue, priorDay = movement?.previousDate;
  const comparable = movement?.date === edition.reviewDate && isCalendarDay(edition.reviewDate)
    && isCalendarDay(priorDay) && priorDay < edition.reviewDate
    && typeof price === "number" && Number.isFinite(price) && price > 0
    && typeof prior === "number" && Number.isFinite(prior) && prior > 0;
  const unitChange = comparable ? price - prior : null;
  const basis = { id, name, unit, unitChange, previousDate: comparable ? priorDay : null };
  const quantity = profile[field];
  const filled = profile.mode === "demo" || (profile.filledFields
    ? profile.filledFields.includes(field) : quantity > 0);
  if (!filled || !Number.isFinite(quantity) || quantity < 0) {
    const note = !profile.filledFields && quantity === 0 ? "旧档案中的零值尚待确认。" : "请在资产档案中填写数量。";
    return { ...basis, state: "missing-quantity", quantity: null, amount: null, note };
  }
  if (quantity === 0) return { ...basis, state: "zero", quantity, amount: 0, note: "档案中已填写零持仓。" };

  const amount = unitChange === null ? null : quantity * unitChange;
  if (amount === null || !Number.isFinite(amount)) {
    const note = movement?.comparisonNote || (id === "domestic"
      ? "缺少复盘日及上一交易日可比的 Au99.99 收盘价。"
      : "缺少复盘日及上一净值日可比的人民币单位净值。");
    return { ...basis, state: "missing-price", quantity, amount: null, note };
  }
  return { ...basis, state: "estimated", quantity, amount, note: id === "domestic"
    ? "按上金所收盘价差估算，平台实际买卖价和费用可能不同。"
    : "按人民币单位净值差估算，另行发放的分红和交易费用需单独核对。" };
}

export function briefHoldingsImpact(profile: Profile, edition: MorningEdition) {
  const rows = holdings.map(holding => holdingImpact(profile, edition, holding));
  const knownSum = rows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
  const complete = rows.every(row => row.amount !== null);
  const hasEstimate = rows.some(row => row.state === "estimated");
  return { rows, total: complete ? knownSum : null, subtotal: !complete && hasEstimate ? knownSum : null };
}
