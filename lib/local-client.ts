import { LOCAL_ASSISTANT_ORIGIN, type LocalModel, type LocalStatus } from "./local-protocol.ts";
import type { createChatMessages } from "./ai.ts";

export class LocalClientError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}

export async function localRequest<T>(token: string, route: string, body?: unknown, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<T> {
  const path = route.split("?")[0];
  if (!["/api/status", "/api/models", "/api/login", "/api/chat", "/api/account/disconnect", "/api/session/close"].includes(path)) throw new LocalClientError("本机操作地址无效。");
  try {
    const timeout = AbortSignal.timeout(path === "/api/chat" ? 185000 : 25000);
    const response = await fetcher(`${LOCAL_ASSISTANT_ORIGIN}${route}`, {
      method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const data = await response.json();
    if (!response.ok) throw new LocalClientError(typeof data.error === "string" ? data.error.slice(0, 300) : "本机操作未完成。", response.status);
    return data as T;
  } catch (error) {
    if (error instanceof LocalClientError) throw error;
    throw new LocalClientError(signal?.aborted ? "已停止等待。" : "无法连接本机助手，请检查它是否正在运行，以及浏览器是否允许访问本机网络。");
  }
}

export const readLocalStatus = (token: string) => localRequest<LocalStatus>(token, "/api/status");
export const readLocalModels = (token: string, accountId: string) => localRequest<{ models: LocalModel[] }>(token, `/api/models?accountId=${encodeURIComponent(accountId)}`);
export function askLocalAssistant(token: string, accountId: string, model: string, messages: ReturnType<typeof createChatMessages>, signal?: AbortSignal) {
  return localRequest<{ content: string; truncated: boolean }>(token, "/api/chat", { accountId, model, messages }, signal);
}
