import { EMPTY_PROFILE, NUMERIC_PROFILE_FIELDS, sanitizeProfile, type NumericProfileField, type Profile } from "./finance.ts";

export type ProfileDraft = Record<NumericProfileField, string>;

export const PROFILE_EXAMPLES: ProfileDraft = {
  cash: "例如 60000", income: "例如 15000", expense: "例如 6000", monthlyDebt: "例如 3000",
  priorityDebt: "例如 10000", nearTerm: "例如 20000", emergencyMonths: "例如 6", maxLoss: "例如 10000",
  goldGrams: "例如 20", goldCost: "例如 18000", goldPrice: "例如 1000", goldBudget: "例如 40000",
  fundUnits: "例如 10000", fundCost: "例如 19000", fundPrice: "例如 2.0000",
};

export function createProfileDraft(profile: Profile): ProfileDraft {
  return Object.fromEntries(NUMERIC_PROFILE_FIELDS.map(key => [key,
    profile.mode === "personal" && (!profile.filledFields || profile.filledFields.includes(key)) ? String(profile[key]) : "",
  ])) as ProfileDraft;
}

export function saveProfileDraft(draft: ProfileDraft, options: Pick<Profile, "risk" | "useGoldQuote" | "useFundNav">,
  savedAt = new Date().toISOString()): Profile {
  const values: Partial<Profile> = {}, filledFields: NumericProfileField[] = [];
  for (const key of NUMERIC_PROFILE_FIELDS) {
    const raw = draft[key].trim();
    const value = raw ? Number(raw) : 0;
    if (!Number.isFinite(value) || value < 0) throw new Error("请填写有效的非负数值，或留空按0保存。");
    if (key === "emergencyMonths" && (!Number.isInteger(value) || value > 24)) throw new Error("应急金月数请填写0至24的整数，或留空。");
    values[key] = value;
    if (raw) filledFields.push(key);
  }
  return sanitizeProfile({ ...EMPTY_PROFILE, ...options, ...values, filledFields, savedAt, mode: "personal" });
}
