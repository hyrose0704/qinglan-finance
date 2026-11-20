import { qdiiScenario } from "./allocation.ts";
import type { Profile, calculate } from "./finance.ts";

export const HOLDINGS_SCENARIOS = [
  { title: "股涨、美元走弱", equity: 10, currency: -5, gold: 3 },
  { title: "股跌、美元走强", equity: -20, currency: 8, gold: 5 },
  { title: "股金同跌", equity: -20, currency: -5, gold: -10 },
] as const;

function positionChange(quantity: number, price: number, value: number, changePercent: number) {
  if (quantity === 0) return 0;
  return price > 0 ? value * changePercent / 100 : null;
}

export function holdingsScenario(
  profile: Profile,
  balances: ReturnType<typeof calculate>,
  scenario: (typeof HOLDINGS_SCENARIOS)[number],
) {
  const fundReturn = qdiiScenario(scenario.equity, scenario.currency);
  const fundChange = positionChange(profile.fundUnits, balances.fundPrice, balances.fundValue, fundReturn);
  const goldChange = positionChange(profile.goldGrams, balances.goldPrice, balances.goldValue, scenario.gold);
  const totalChange = fundChange === null || goldChange === null ? null : fundChange + goldChange;
  const empty = profile.cash === 0 && profile.fundUnits === 0 && profile.goldGrams === 0;
  return { fundReturn, fundChange, goldChange, totalChange, empty };
}
