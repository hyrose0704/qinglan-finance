import { NUMERIC_PROFILE_FIELDS, sanitizeProfile, type Profile } from "./finance.ts";

// These names stay stable across deployments. Account caches never replace the guest record.
export const PROFILE_KEY = "qinglan-profile-v1";
export interface ProfileCopy {
  profile: Profile;
  revision: number;
  pending: boolean;
  copiedAt: string;
  sequence?: number;
}
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; }
export interface EditBase { key: string; revision: number; }

export function draftRevision(current: EditBase, opened = current): number {
  if (opened.key !== current.key) throw new Error("当前账号已变更，请回到原账号核对后保存。");
  return opened.revision;
}

export function personalProfile(value: unknown): Profile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("资金档案格式无效。");
  const raw = value as Record<string, unknown>;
  if (raw.mode !== "personal" || !["cash", "goldGrams", "fundUnits"].every(key => typeof raw[key] === "number")) {
    throw new Error("只保存个人资金档案，示例不会上传。");
  }
  const clean: Partial<Profile> = { mode: "personal" };
  for (const key of NUMERIC_PROFILE_FIELDS) {
    const n = raw[key] ?? 0;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100000000000) throw new Error("资金档案中有无效数值。");
    clean[key] = n;
  }
  if (!Number.isInteger(clean.emergencyMonths) || clean.emergencyMonths! > 24) throw new Error("应急金月数无效。");
  clean.risk = raw.risk === "steady" || raw.risk === "growth" ? raw.risk : "balanced";
  clean.useGoldQuote = raw.useGoldQuote === true;
  clean.useFundNav = raw.useFundNav === true;
  const filled = raw.filledFields;
  if (Array.isArray(filled)) clean.filledFields = NUMERIC_PROFILE_FIELDS.filter(key => filled.includes(key));
  if (typeof raw.savedAt === "string" && Number.isFinite(Date.parse(raw.savedAt))) clean.savedAt = new Date(raw.savedAt).toISOString();
  return sanitizeProfile(clean);
}

export function profileScope(project: string, userId: string): string {
  return `qinglan-profile-account-v1:${encodeURIComponent(project)}:${encodeURIComponent(userId)}`;
}

function parseCopy(value: unknown): ProfileCopy {
  const raw = value as ProfileCopy;
  if (!raw || !Number.isSafeInteger(raw.revision) || raw.revision < 0 || typeof raw.pending !== "boolean" || !Number.isFinite(Date.parse(raw.copiedAt))) throw new Error("备份无效。");
  return { ...raw, profile: personalProfile(raw.profile) };
}

export function localHistory(storage: StorageLike, key = PROFILE_KEY): ProfileCopy[] {
  try {
    const rows = JSON.parse(storage.getItem(`${key}:history-v1`) || "[]");
    return Array.isArray(rows) ? rows.slice(-10).flatMap(row => { try { return [parseCopy(row)]; } catch { return []; } }) : [];
  } catch { return []; }
}

export function readProfileCopy(storage: StorageLike, key = PROFILE_KEY): { copy: ProfileCopy | null; recovered: boolean; error: boolean } {
  let error = false;
  let main: ProfileCopy | null = null;
  try {
    const serialized = storage.getItem(key);
    if (serialized) {
      const raw = JSON.parse(serialized);
      main = raw?.profile ? parseCopy(raw) : { profile: personalProfile(raw), revision: 0, pending: false, copiedAt: raw.savedAt || new Date().toISOString() };
    }
  } catch { error = true; }
  const copy = localHistory(storage, key).at(-1) || null;
  if (main && (!copy || (main.sequence || 0) >= (copy.sequence || 0))) return { copy: main, recovered: false, error };
  return { copy, recovered: !!copy, error };
}

export function writeProfileCopy(storage: StorageLike, value: ProfileCopy, key = PROFILE_KEY): { saved: boolean; warning: string } {
  const previous = readProfileCopy(storage, key).copy;
  const copy = { ...parseCopy(value), sequence: (previous?.sequence || 0) + 1 }, serialized = JSON.stringify(copy);
  let main = false, backup = false;
  try {
    const history = localHistory(storage, key);
    const latest = history.at(-1);
    // Refreshing the same server revision repairs both copies without evicting older saves.
    // Revision zero belongs to local saves, and pending entries record explicit edits.
    if (latest && !latest.pending && !copy.pending && copy.revision > 0 && latest.revision === copy.revision && sameProfile(latest.profile, copy.profile)) {
      history.pop();
    }
    history.push(copy);
    storage.setItem(`${key}:history-v1`, JSON.stringify(history.slice(-10)));
    backup = true;
  } catch { /* The primary write still has a chance when backup storage is full. */ }
  try { storage.setItem(key, serialized); main = true; } catch { /* Preserve the successful backup if the primary write fails. */ }
  return { saved: main || backup, warning: !main && !backup ? "浏览器保存失败，请先导出档案。" : !main || !backup ? "浏览器副本未完整写入，请导出一份备份。" : "" };
}

export function sameProfile(a: Profile, b: Profile): boolean {
  const values = (p: Profile) => [NUMERIC_PROFILE_FIELDS.map(key => p[key]), p.risk, p.useGoldQuote, p.useFundNav, p.filledFields || null];
  return JSON.stringify(values(a)) === JSON.stringify(values(b));
}

export type CloudRead = { profile: Profile; revision: number; updatedAt: string } | null;
export function reconcileProfiles(local: ProfileCopy | null, remote: CloudRead) {
  if (local?.pending) {
    if (remote && sameProfile(local.profile, remote.profile)) return { action: "remote" as const, remote };
    return { action: (local.revision === (remote?.revision || 0) ? "pending" : "conflict") as "pending" | "conflict", local, remote };
  }
  return { action: "remote" as const, remote };
}
