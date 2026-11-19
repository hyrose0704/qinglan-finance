import { useEffect, useRef, useState } from "react";
import { askLocalAssistant, localRequest, readLocalModels, readLocalStatus, LocalClientError } from "@/lib/local-client";
import { LOCAL_ASSISTANT_ORIGIN, type LocalAccount, type LocalModel, type LocalStatus } from "@/lib/local-protocol";
import type { createChatMessages } from "@/lib/ai";

const LABEL_KEY = "qinglan-local-account-label-v1";
function lastAccount() {
  try { const value = JSON.parse(localStorage.getItem(LABEL_KEY) || "null"); return typeof value?.email === "string" ? { id: String(value.id || ""), email: value.email.slice(0, 200) } : null; }
  catch { return null; }
}

export function useLocalAssistant() {
  const capability = useRef("");
  const [connected, setConnected] = useState(false), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<LocalStatus>({ accounts: [], login: null });
  const [accountId, setAccountId] = useState(""), [models, setModels] = useState<LocalModel[]>([]);
  const [cached, setCached] = useState(lastAccount), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const loginPopup = useRef<Window | null>(null), pairCleanup = useRef<(() => void) | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const account = status.accounts.find(item => item.id === accountId);

  async function selectAccount(id: string, available = status.accounts) {
    setAccountId(id); setModels([]);
    const selected = available.find(item => item.id === id); if (!selected) return;
    const label = { id: selected.id, email: selected.email }; setCached(label);
    try { localStorage.setItem(LABEL_KEY, JSON.stringify(label)); } catch { setNotice("账号已选中，但浏览器未能保存显示信息。本机授权记录不受影响。"); }
    if (selected.connected && selected.sharing) setModels((await readLocalModels(capability.current, id)).models);
  }

  async function refresh() {
    if (!capability.current) return;
    try {
      const next = await readLocalStatus(capability.current); setStatus(next);
      const id = next.login?.accountId && !next.login.pending && !next.login.error ? next.login.accountId
        : next.accounts.some(item => item.id === accountId) ? accountId
        : next.accounts.find(item => item.id === cached?.id)?.id || next.accounts[0]?.id || "";
      if (id) {
        const previous = status.accounts.find(item => item.id === id), current = next.accounts.find(item => item.id === id);
        if (id !== accountId || current?.connected !== previous?.connected || current?.sharing !== previous?.sharing || (!models.length && current?.sharing)) await selectAccount(id, next.accounts);
      }
      if (next.login?.error) setError(next.login.error);
    } catch (value) {
      setError(value instanceof Error ? value.message : "读取本机账号失败。");
      if (value instanceof LocalClientError && value.status === 401) { capability.current = ""; setConnected(false); setModels([]); }
    }
  }

  async function connect() {
    if (busy) return; setBusy(true); setError(""); setNotice("");
    const popup = window.open("about:blank", "qinglan-local-connect", "width=600,height=650");
    try {
      if (!popup) throw new Error("请允许青览打开连接窗口，然后重试。");
      const health = await fetch(`${LOCAL_ASSISTANT_ORIGIN}/health`, { signal: AbortSignal.timeout(5000), credentials: "omit", cache: "no-store", redirect: "error" });
      if (!health.ok || (await health.json()).app !== "qinglan-local-assistant") throw new Error("本机助手尚未就绪。");
      const state = crypto.randomUUID(), url = new URL(`${LOCAL_ASSISTANT_ORIGIN}/connect`);
      url.searchParams.set("origin", window.location.origin); url.searchParams.set("state", state);
      const session = await new Promise<string>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); pairCleanup.current = null; };
        const receive = (event: MessageEvent) => {
          if (event.origin !== LOCAL_ASSISTANT_ORIGIN || event.source !== popup || event.data?.type !== "qinglan-local-connected" || event.data.state !== state || !/^[\w-]{43}$/.test(event.data.token || "")) return;
          cleanup(); resolve(event.data.token);
        };
        window.addEventListener("message", receive); timer = setTimeout(() => { cleanup(); reject(new Error("连接确认已超时，请重新连接本机助手。")); }, 120000);
        pairCleanup.current = cleanup; popup.location.href = url.toString();
      });
      capability.current = session; setConnected(true);
      const next = await readLocalStatus(session); setStatus(next);
      const id = next.accounts.find(item => item.id === cached?.id)?.id || next.accounts[0]?.id;
      if (id) await selectAccount(id, next.accounts);
      setNotice("已连接本机程序。请选择已保存账号，或继续官方登录。");
    } catch (value) {
      popup?.close(); setError(value instanceof Error && value.name !== "TypeError" ? value.message : "本机助手未启动或浏览器尚未允许本机访问。请先启动程序，再重新连接。");
    } finally { setBusy(false); }
  }

  async function login(newAccount = false) {
    if (!capability.current || busy) return; setBusy(true); setError("");
    const popup = window.open("about:blank", "qinglan-openai-login", "width=650,height=760");
    try {
      if (!popup) throw new Error("请允许青览打开官方登录窗口后重试。");
      const result = await localRequest<{ authUrl: string }>(capability.current, "/api/login", { accountId: newAccount ? null : accountId || null });
      const url = new URL(result.authUrl);
      if (url.origin !== "https://auth.openai.com") throw new Error("官方登录地址不符合预期。");
      loginPopup.current = popup; popup.location.href = result.authUrl;
      setNotice("请在 OpenAI 官方窗口选择账号并授权。完成后返回此处刷新账号状态。");
      setStatus(previous => ({ ...previous, login: { pending: true, error: "", accountId: "" } }));
    } catch (value) { popup?.close(); setError(value instanceof Error ? value.message : "无法开始官方登录。"); }
    finally { setBusy(false); }
  }

  async function chooseAccount(id: string) {
    setBusy(true); setError("");
    try { await selectAccount(id); } catch (value) { setError(value instanceof Error ? value.message : "无法选择该账号。"); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (!accountId) return; setBusy(true); setError("");
    try {
      const result = await localRequest<{ revoked: boolean }>(capability.current, "/api/account/disconnect", { accountId });
      setModels([]); await refresh();
      setNotice(result.revoked ? "已退出所选账号；账号名称保留，之后可以重新授权。" : "本机凭证已清除，远端撤销未确认。可在 ChatGPT 设置中断开青览。");
    } catch (value) { setError(value instanceof Error ? value.message : "退出未完成。"); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    try { if (capability.current) await localRequest(capability.current, "/api/session/close", {}); } catch { /* A restarted local process has already invalidated this session. */ }
    capability.current = ""; setConnected(false); setStatus({ accounts: [], login: null }); setModels([]); setNotice("已断开网页连接，本机账号授权仍保留。");
  }

  refreshRef.current = refresh;
  useEffect(() => {
    const receive = (event: MessageEvent) => { if (event.origin === LOCAL_ASSISTANT_ORIGIN && event.source === loginPopup.current && event.data?.type === "qinglan-login-updated") void refreshRef.current(); };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    if (!connected || !status.login?.pending) return;
    const timer = setInterval(() => void refreshRef.current(), 5000); return () => clearInterval(timer);
  }, [connected, status.login?.pending]);
  useEffect(() => () => pairCleanup.current?.(), []);

  return { connected, busy, status, account, accountId, models, cached, error, notice, connect, login, chooseAccount, refresh, signOut, disconnect,
    ask: (model: string, messages: ReturnType<typeof createChatMessages>, signal?: AbortSignal) => askLocalAssistant(capability.current, accountId, model, messages, signal) };
}
