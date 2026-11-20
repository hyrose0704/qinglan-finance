import type { SupabaseClient } from "@supabase/supabase-js";
import { personalProfile, type CloudRead } from "./profile-storage.ts";
import type { Profile } from "./finance.ts";

export interface CloudConfig { url: string; publishableKey: string; }
export const CLOUD_CONFIG_KEY = "qinglan-cloud-config-v1";

// Email verification happens at Supabase. Only the registering browser has the PKCE verifier.
export function emailConfirmationReturn(href: string) {
  const url = new URL(href), fragment = new URLSearchParams(url.hash.slice(1));
  const code = url.searchParams.get("code");
  const isError = ["error", "error_code", "error_description"].some(name => url.searchParams.has(name) || fragment.has(name));
  const legacy = fragment.has("access_token") || fragment.has("refresh_token");
  if (!code && !isError && !legacy) return null;
  for (const name of ["code", "error", "error_code", "error_description"]) url.searchParams.delete(name);
  if (legacy || fragment.has("error") || fragment.has("error_code") || fragment.has("error_description")) url.hash = "";
  return { code: isError || legacy ? null : code, isError, cleanUrl: url.pathname + url.search + url.hash };
}

export function parseCloudConfig(value: unknown): CloudConfig | null {
  const raw = value as Partial<CloudConfig> | null;
  if (!raw?.url && !raw?.publishableKey) return null;
  if (typeof raw?.url !== "string" || typeof raw.publishableKey !== "string") throw new Error("请填写数据库地址和公开连接 Key。");
  const url = new URL(raw.url.trim());
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("请填写 Supabase 项目的 https://项目编号.supabase.co 地址。");
  }
  const key = raw.publishableKey.trim();
  if (!/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key)) {
    let role = "";
    try { role = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role; } catch { /* Only a public anon JWT is supported. */ }
    if (role !== "anon") throw new Error("只接受 publishable / anon 公开 Key；不能把 secret 或 service_role Key 放进网页。");
  }
  return { url: url.origin, publishableKey: key };
}

export async function connectCloud(config: CloudConfig): Promise<SupabaseClient> {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(config.url, config.publishableKey, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: `qinglan-cloud-auth:${new URL(config.url).hostname}` },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal || AbortSignal.timeout(15000) }) },
  });
}

export function readCloudRow(row: unknown): NonNullable<CloudRead> {
  const value = row as Record<string, unknown>;
  if (!value || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || typeof value.updated_at !== "string" || !Number.isFinite(Date.parse(value.updated_at))) throw new Error("云端档案格式不符合预期，未覆盖浏览器副本。");
  return { profile: personalProfile(value.profile), revision: Number(value.revision), updatedAt: value.updated_at };
}

export async function loadCloudProfile(client: SupabaseClient, userId: string): Promise<CloudRead> {
  const { data, error } = await client.from("qinglan_profiles").select("profile,revision,updated_at").eq("user_id", userId).maybeSingle();
  if (error) throw cloudError(error);
  return data ? readCloudRow(data) : null;
}

export async function saveCloudProfile(client: SupabaseClient, profile: Profile, revision: number, userId: string): Promise<NonNullable<CloudRead>> {
  const { data, error } = await client.rpc("qinglan_save_profile", { p_profile: personalProfile(profile), p_expected_revision: revision, p_expected_user_id: userId });
  if (error) throw cloudError(error);
  return readCloudRow(data);
}

export async function loadCloudHistory(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from("qinglan_profile_versions").select("profile,revision,updated_at").eq("user_id", userId).order("revision", { ascending: false }).limit(20);
  if (error) throw cloudError(error);
  return (data || []).map(readCloudRow);
}

export class ProfileConflict extends Error {}
export function cloudError(error: { code?: string; message?: string; status?: number }): Error {
  if (error.code === "QF409") return new ProfileConflict("另一台设备已保存新版本，本次内容已保留在浏览器，请先比较版本。");
  if (error.code === "PGRST205" || error.code === "PGRST202" || error.code === "42P01") return new Error("云数据库尚未初始化，请由管理员运行建表脚本。");
  if (error.code === "23514" || error.code === "QF422") return new Error("数据库拒绝了无效档案，请核对输入。");
  if (error.code === "42501" || error.code === "PGRST301" || error.code === "QF401") return new Error("数据库登录已过期或没有权限，请重新登录。");
  return new Error("云端连接暂未成功。浏览器副本保留，请稍后重试。");
}
