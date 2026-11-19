import { RISK_MIX, type Profile, type calculate } from "./finance.ts";

export interface PlanningPreferences {
  horizon: "unknown" | "within3" | "3to5" | "over5";
  income: "unknown" | "stable" | "variable";
  experience: "unknown" | "learning" | "familiar";
}

export const EMPTY_PREFERENCES: PlanningPreferences = {
  horizon: "unknown", income: "unknown", experience: "unknown",
};

export function readPreferences(value: unknown): PlanningPreferences {
  if (!value || typeof value !== "object") return { ...EMPTY_PREFERENCES };
  const p = value as Record<string, unknown>;
  return {
    horizon: ["within3", "3to5", "over5"].includes(String(p.horizon))
      ? p.horizon as PlanningPreferences["horizon"] : "unknown",
    income: ["stable", "variable"].includes(String(p.income))
      ? p.income as PlanningPreferences["income"] : "unknown",
    experience: ["learning", "familiar"].includes(String(p.experience))
      ? p.experience as PlanningPreferences["experience"] : "unknown",
  };
}

export const LEARNING_SHOCKS = { equity: 40, gold: 20 };

type Balances = ReturnType<typeof calculate>;

function downToCent(value: number): number {
  return Math.floor(Math.max(0, value) * 100 + 1e-7) / 100;
}

export function buildLearningPlan(
  profile: Profile,
  balances: Balances,
  rawPreferences: PlanningPreferences,
  assumptions = LEARNING_SHOCKS,
) {
  const preferences = readPreferences(rawPreferences);
  const missing = [
    preferences.horizon === "unknown" ? "用款时间" : "",
    preferences.income === "unknown" ? "收入稳定性" : "",
    preferences.experience === "unknown" ? "产品理解程度" : "",
  ].filter(Boolean);
  const equityShock = Math.min(60, Math.max(10, Number(assumptions.equity) || 40)) / 100;
  const goldShock = Math.min(40, Math.max(10, Number(assumptions.gold) || 20)) / 100;
  const reasons: string[] = [];
  let equityWeight: number = RISK_MIX[profile.risk].equity;
  let goldWeight: number = RISK_MIX[profile.risk].gold;
  reasons.push(`从你选择的${RISK_MIX[profile.risk].name}学习模板开始，再逐项收紧。`);

  if (preferences.horizon === "within3") {
    equityWeight = 0;
    goldWeight = 0;
    reasons.push("这笔钱3年内要用：本学习模型将它全部留在待配置现金栏。还需匹配产品期限与到账时间。");
  } else if (preferences.horizon === "3to5") {
    equityWeight = Math.min(equityWeight, 0.25);
    goldWeight = Math.min(goldWeight, 0.10);
    reasons.push("3—5年用款：本模型将股票类上限设为25%、黄金上限设为10%，作为保守的比较规则。");
  }
  if (preferences.income === "variable") {
    equityWeight = Math.min(equityWeight, 0.25);
    goldWeight = Math.min(goldWeight, 0.10);
    reasons.push("收入波动较大：本模型限制新增风险敞口。也请比较更长的应急金预留，月数仍以你填写的值为准。");
  }
  if (preferences.experience === "learning") {
    equityWeight = Math.min(equityWeight, 0.20);
    goldWeight = Math.min(goldWeight, 0.10);
    reasons.push("仍在学习产品规则：本模型将股票类上限设为20%、黄金上限设为10%。理解风险不代表必须提高比例。");
  }

  const blocked = missing.length > 0 || balances.reserveGap > 0 || balances.monthlyDeficit > 0
    || profile.expense + profile.monthlyDebt <= 0 || balances.longTerm <= 0;
  if (blocked) {
    equityWeight = 0;
    goldWeight = 0;
  }
  const originalStress = balances.longTerm * (equityWeight * equityShock + goldWeight * goldShock);
  const scale = originalStress > 0 ? Math.min(1, profile.maxLoss / originalStress) : 1;
  if (scale < 1) reasons.push("模板情景损失超过你填写的承受金额：同比缩小两类风险资产，其余留在待配置现金栏。");
  const equity = downToCent(balances.longTerm * equityWeight * scale);
  const gold = downToCent(balances.longTerm * goldWeight * scale);
  const cash = Math.max(0, balances.longTerm - equity - gold);
  const currentStress = balances.fundValue * equityShock + balances.goldValue * goldShock;
  const targetStress = equity * equityShock + gold * goldShock;
  const currentCash = balances.freeCash;

  const reserveTopup = Math.min(balances.surplus, balances.reserveGap);
  const remaining = Math.max(0, balances.surplus - reserveTopup);
  const needs = {
    cash: Math.max(0, cash - currentCash),
    equity: Math.max(0, equity - balances.fundValue),
    gold: Math.max(0, Math.min(gold - balances.goldValue, profile.goldBudget - profile.goldCost)),
  };
  const needsTotal = needs.cash + needs.equity + needs.gold;
  const fill = !blocked && needsTotal > 0 ? Math.min(remaining / needsTotal, 1) : 0;
  const proposedEquity = needs.equity * fill;
  const proposedGold = needs.gold * fill;
  const addedStress = proposedEquity * equityShock + proposedGold * goldShock;
  const riskRoom = Math.max(0, profile.maxLoss - currentStress);
  const addedScale = addedStress > 0 ? Math.min(1, riskRoom / addedStress) : 0;
  const monthlyEquity = downToCent(proposedEquity * addedScale);
  const monthlyGold = downToCent(proposedGold * addedScale);
  const monthlyCash = Math.max(0, remaining - monthlyEquity - monthlyGold);

  return {
    missing, blocked, reasons, equityShock, goldShock, scale,
    target: { cash, equity, gold }, currentStress, targetStress,
    current: { cash: currentCash, equity: balances.fundValue, gold: balances.goldValue },
    monthly: { reserve: reserveTopup, cash: monthlyCash, equity: monthlyEquity, gold: monthlyGold },
    monthsToReserve: balances.reserveGap > 0 && balances.surplus > 0
      ? Math.ceil(balances.reserveGap / balances.surplus) : null,
  };
}

export function compoundScenario(principal: number, monthly: number, annualReturn: number, annualFee: number, years: number) {
  if (![principal, monthly, annualReturn, annualFee, years].every(Number.isFinite)
      || principal < 0 || monthly < 0 || annualReturn <= -100 || annualFee < 0 || annualFee >= 100
      || years < 0 || years > 50) throw new RangeError("Invalid scenario inputs");
  const months = Math.round(years * 12);
  const rate = Math.pow((1 + annualReturn / 100) * (1 - annualFee / 100), 1 / 12) - 1;
  let value = principal;
  for (let i = 0; i < months; i++) value = value * (1 + rate) + monthly;
  return { value, contributed: principal + monthly * months };
}

export function qdiiScenario(assetReturn: number, currencyReturn: number): number {
  return ((1 + assetReturn / 100) * (1 + currencyReturn / 100) - 1) * 100;
}

export function recoveryReturn(loss: number): number {
  if (!Number.isFinite(loss) || loss < 0 || loss >= 100) throw new RangeError("Loss must be between 0 and 100");
  return loss / (100 - loss) * 100;
}
