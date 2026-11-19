export type Risk = "steady" | "balanced" | "growth";

export interface Profile {
  mode: "demo" | "personal";
  cash: number;
  income: number;
  expense: number;
  monthlyDebt: number;
  priorityDebt: number;
  nearTerm: number;
  emergencyMonths: number;
  maxLoss: number;
  goldGrams: number;
  goldCost: number;
  goldPrice: number;
  goldBudget: number;
  fundUnits: number;
  fundCost: number;
  fundPrice: number;
  useGoldQuote: boolean;
  useFundNav: boolean;
  risk: Risk;
  savedAt?: string;
}

export const DEMO: Profile = {
  mode: "demo", cash: 60000, income: 15000, expense: 6000,
  monthlyDebt: 0, priorityDebt: 0, nearTerm: 20000, emergencyMonths: 6,
  maxLoss: 10000, goldGrams: 20, goldCost: 18000, goldPrice: 1000,
  goldBudget: 40000, fundUnits: 10000, fundCost: 19000, fundPrice: 2,
  useGoldQuote: false, useFundNav: false, risk: "balanced",
};

export const RISK_MIX = {
  steady: { name: "稳健", stable: 0.65, equity: 0.25, gold: 0.10 },
  balanced: { name: "均衡", stable: 0.40, equity: 0.45, gold: 0.15 },
  growth: { name: "成长", stable: 0.20, equity: 0.65, gold: 0.15 },
} as const;

export function nonnegative(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

export function sanitizeProfile(value: Partial<Profile>): Profile {
  const p = { ...DEMO, ...value };
  const numeric: (keyof Profile)[] = ["cash", "income", "expense", "monthlyDebt", "priorityDebt", "nearTerm", "emergencyMonths", "maxLoss", "goldGrams", "goldCost", "goldPrice", "goldBudget", "fundUnits", "fundCost", "fundPrice"];
  for (const k of numeric) Object.assign(p, { [k]: nonnegative(p[k]) });
  p.emergencyMonths = Math.min(24, Math.max(3, p.emergencyMonths));
  p.risk = p.risk in RISK_MIX ? p.risk : "balanced";
  p.mode = p.mode === "personal" ? "personal" : "demo";
  p.useGoldQuote = p.useGoldQuote === true;
  p.useFundNav = p.useFundNav === true;
  return p;
}

export function calculate(p: Profile, prices?: { gold?: number | null; fund?: number | null }, shocks = { equity: 30, gold: 15, stable: 3 }) {
  const goldPrice = p.useGoldQuote && prices?.gold && prices.gold > 0 ? prices.gold : p.goldPrice;
  const fundPrice = p.useFundNav && prices?.fund && prices.fund > 0 ? prices.fund : p.fundPrice;
  const goldValue = p.goldGrams * goldPrice;
  const fundValue = p.fundUnits * fundPrice;
  const total = p.cash + goldValue + fundValue;
  const monthlyEssential = p.expense + p.monthlyDebt;
  const emergency = monthlyEssential * p.emergencyMonths;
  const reserve = emergency + p.nearTerm + p.priorityDebt;
  const reserveGap = Math.max(0, reserve - p.cash);
  const freeCash = Math.max(0, p.cash - reserve);
  const longTerm = Math.max(0, total - reserve);
  const surplus = Math.max(0, p.income - monthlyEssential);
  const monthlyDeficit = Math.max(0, monthlyEssential - p.income);
  const mix = RISK_MIX[p.risk];
  const target = { stable: longTerm * mix.stable, equity: longTerm * mix.equity, gold: longTerm * mix.gold };
  const currentStress = goldValue * shocks.gold / 100 + fundValue * shocks.equity / 100;
  const targetStress = target.stable * shocks.stable / 100 + target.equity * shocks.equity / 100 + target.gold * shocks.gold / 100;
  const goldRoom = Math.max(0, Math.min(p.goldBudget - p.goldCost, target.gold - goldValue));
  const riskRoom = shocks.gold > 0 ? Math.max(0, (p.maxLoss - currentStress) / (shocks.gold / 100)) : 0;
  const conditionalGold = reserveGap > 0 || monthlyDeficit > 0 ? 0 : Math.max(0, Math.min(7000, freeCash, goldRoom, riskRoom));
  return { goldPrice, fundPrice, goldValue, fundValue, total, emergency, reserve, reserveGap, freeCash, longTerm, surplus, monthlyDeficit, target, currentStress, targetStress, conditionalGold,
    pnl: goldValue + fundValue - p.goldCost - p.fundCost,
    goldWeight: total > 0 ? goldValue / total * 100 : 0,
    equityWeight: total > 0 ? fundValue / total * 100 : 0,
    emergencyCoverage: monthlyEssential > 0 ? Math.min(p.emergencyMonths, Math.max(0, p.cash - p.nearTerm - p.priorityDebt) / monthlyEssential) : p.emergencyMonths,
  };
}

export function money(n: number, decimals = 0): string {
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}

export function quoteFresh(timestamp?: string | null, now = Date.now()): boolean {
  if (!timestamp) return false;
  const age = now - Date.parse(timestamp);
  return Number.isFinite(age) && age >= -60_000 && age <= 15 * 60_000;
}
