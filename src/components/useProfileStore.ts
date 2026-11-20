import { useEffect, useRef, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { DEMO, type Profile } from "@/lib/finance";
import { CLOUD_CONFIG_KEY, connectCloud, emailConfirmationReturn, loadCloudHistory, loadCloudProfile, parseCloudConfig, ProfileConflict, saveCloudProfile, type CloudConfig } from "@/lib/cloud-profile";
import { PROFILE_KEY, draftRevision, localHistory, personalProfile, profileScope, readProfileCopy, reconcileProfiles, writeProfileCopy, type CloudRead, type EditBase, type ProfileCopy } from "@/lib/profile-storage";

type Phase = "starting" | "unconfigured" | "signed-out" | "loading" | "ready" | "pending" | "conflict" | "error";
const browserStorage = { getItem: (key: string) => localStorage.getItem(key), setItem: (key: string, value: string) => localStorage.setItem(key, value) };
export function useProfileStore() {
  const [profile, setProfile] = useState<Profile>(DEMO), [saved, setSaved] = useState<Profile | null>(null);
  const [phase, setPhase] = useState<Phase>("starting"), [user, setUser] = useState<User | null>(null);
  const [configured, setConfigured] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [unsaved, setUnsaved] = useState(false);
  const [confirmation] = useState(() => emailConfirmationReturn(window.location.href));
  const [authNotice, setAuthNotice] = useState("");
  const [remote, setRemote] = useState<CloudRead>(null), [guest, setGuest] = useState<Profile | null>(null);
  const [history, setHistory] = useState<NonNullable<CloudRead>[]>([]), [localCopies, setLocalCopies] = useState<ProfileCopy[]>([]);
  const actor = useRef({ epoch: 0, userId: "", key: PROFILE_KEY, revision: 0, writable: false });
  const clientRef = useRef<SupabaseClient | null>(null), configRef = useRef<CloudConfig | null>(null), saving = useRef(false);
  const remoteRef = useRef<CloudRead>(null);
  const remoteKnown = useRef(false);

  function remember(copy: ProfileCopy, key: string) {
    try {
      const result = writeProfileCopy(browserStorage, copy, key);
      setLocalCopies(localHistory(browserStorage, key).reverse());
      return result;
    } catch { return { saved: false, warning: "浏览器保存失败，请先导出档案。" }; }
  }

  async function readAccount(account: User) {
    const client = clientRef.current, config = configRef.current;
    if (!client || !config) return;
    const epoch = ++actor.current.epoch, key = profileScope(config.url, account.id);
    actor.current = { epoch, userId: account.id, key, revision: 0, writable: false };
    setUser(account); setPhase("loading"); setMessage(""); setHistory([]); setRemote(null); remoteRef.current = null; remoteKnown.current = false;
    const local = readProfileCopy(browserStorage, key).copy;
    actor.current.revision = local?.revision || 0;
    setProfile(local?.profile || DEMO); setSaved(local?.profile || null); setUnsaved(false); setLocalCopies(localHistory(browserStorage, key).reverse());
    try {
      const latest = await loadCloudProfile(client, account.id);
      if (actor.current.epoch !== epoch) return;
      actor.current.revision = latest?.revision || 0; actor.current.writable = true;
      remoteRef.current = latest; setRemote(latest); remoteKnown.current = true;
      const result = reconcileProfiles(local, latest);
      if (result.action !== "remote") {
        actor.current.revision = local!.revision;
        setPhase(result.action); setMessage(result.action === "conflict" ? "这台设备有待同步内容，云端也有更新。请比较后选择，不会自动覆盖。" : "这台设备有待同步内容，点击“同步当前档案”后上传。");
      } else {
        setProfile(latest?.profile || DEMO); setSaved(latest?.profile || null); setPhase("ready");
        if (latest) remember({ profile: latest.profile, revision: latest.revision, pending: false, copiedAt: latest.updatedAt }, key);
      }
    } catch (error) {
      if (actor.current.epoch !== epoch) return;
      setPhase("error"); setMessage(error instanceof Error ? error.message : "云端读取失败，未覆盖浏览器副本。");
    }
  }
  const readRef = useRef(readAccount); readRef.current = readAccount;

  useEffect(() => {
    let active = true, subscription: { unsubscribe(): void } | undefined;
    function loadGuest() {
      const result = readProfileCopy(browserStorage);
      setGuest(result.copy?.profile || null); setSaved(result.copy?.profile || null); setProfile(result.copy?.profile || DEMO);
      setUnsaved(false); setLocalCopies(localHistory(browserStorage).reverse());
      if (result.recovered) setMessage("已从浏览器历史副本恢复个人档案，建议导出备份并登录云端。");
      else if (result.error) setMessage("原档案读取失败，未覆盖原始记录。请导入备份或登录云端恢复。");
    }
    async function initialize() {
      if (confirmation) window.history.replaceState(window.history.state, "", confirmation.cleanUrl);
      loadGuest();
      try {
        let config: CloudConfig | null = null;
        try { config = parseCloudConfig(JSON.parse(localStorage.getItem(CLOUD_CONFIG_KEY) || "null")); } catch { /* A blocked or damaged local override must not block the published configuration. */ }
        if (!config) {
          const response = await fetch(`${import.meta.env.BASE_URL}data/cloud-config.json`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
          if (!response.ok) throw new Error("数据库配置读取失败。");
          config = parseCloudConfig(await response.json());
        }
        if (!active) return;
        if (!config) { setPhase("unconfigured"); return; }
        configRef.current = config; const client = await connectCloud(config);
        if (!active) { client.auth.stopAutoRefresh(); return; }
        clientRef.current = client; setConfigured(true);
        if (confirmation) {
          let notice = "请使用注册邮箱和密码登录。若提示邮箱尚未验证，请在注册设备打开最新的确认邮件。";
          if (confirmation.isError) notice = "确认链接已失效或无法验证。请先尝试登录，若邮箱尚未验证，请重新申请确认邮件。";
          else if (confirmation.code) {
            try {
              const { error } = await client.auth.exchangeCodeForSession(confirmation.code);
              if (!error) notice = "邮箱已确认，已登录资金档案。";
            } catch { /* Other devices can sign in with a password after email confirmation. */ }
          }
          if (!active) return;
          setAuthNotice(notice);
        }
        subscription = client.auth.onAuthStateChange((_event, session) => {
          if (!active) return;
          // Supabase auth callbacks must not await another auth/database operation inside the callback.
          setTimeout(() => {
            if (!active) return;
            if (session?.user) {
              if (actor.current.userId !== session.user.id) void readRef.current(session.user);
            } else {
              ++actor.current.epoch; actor.current = { ...actor.current, userId: "", key: PROFILE_KEY, revision: 0, writable: false };
              setUser(null); setPhase("signed-out"); setRemote(null); remoteRef.current = null; setHistory([]); loadGuest();
            }
          }, 0);
        }).data.subscription;
      } catch { if (active) { setPhase("unconfigured"); setMessage("云数据库配置暂未就绪，资产仍可保存到浏览器并导出。"); } }
    }
    void initialize();
    return () => { active = false; ++actor.current.epoch; subscription?.unsubscribe(); clientRef.current?.auth.stopAutoRefresh(); };
  }, []);

  async function save(value: Profile, reviewedConflict = false, editBase?: EditBase): Promise<boolean> {
    if (saving.current) return false;
    const p = personalProfile({ ...value, savedAt: new Date().toISOString() });
    const current = { ...actor.current }, client = clientRef.current;
    const revision = draftRevision(current, editBase);
    if (phase === "loading" || phase === "starting") { setMessage("正在读取账号档案，请稍后再保存。"); return false; }
    saving.current = true; setBusy(true); setHistory([]);
    const local = remember({ profile: p, revision, pending: !!current.userId, copiedAt: new Date().toISOString() }, current.key);
    setProfile(p); setUnsaved(!local.saved); if (local.saved) setSaved(p);
    if (!current.userId) {
      if (local.saved) setGuest(p); setMessage(local.saved ? `已保存到此浏览器，尚未同步云端。${local.warning}` : local.warning);
      saving.current = false; setBusy(false); return local.saved;
    }
    if (revision !== current.revision) {
      actor.current.revision = revision;
      setPhase("conflict"); setMessage("编辑期间账号档案有更新。请在个人中心比较本次输入与云端版本后再保存。");
      saving.current = false; setBusy(false); return local.saved;
    }
    if (!client || !current.writable || (phase === "conflict" && !reviewedConflict)) {
      setPhase(phase === "conflict" ? "conflict" : "error"); setMessage(local.saved ? "已保存浏览器副本，云端未同步。请先刷新云端档案并解决版本差异。" : local.warning);
      saving.current = false; setBusy(false); return local.saved;
    }
    try {
      const latest = await saveCloudProfile(client, p, revision, current.userId);
      if (actor.current.epoch !== current.epoch) return local.saved;
      actor.current.revision = latest.revision; remoteRef.current = latest; setRemote(latest); setPhase("ready");
      setSaved(latest.profile); setUnsaved(false);
      remember({ profile: latest.profile, revision: latest.revision, pending: false, copiedAt: latest.updatedAt }, current.key);
      setMessage(`云端已保存 · 第 ${latest.revision} 版。${local.warning}`); return true;
    } catch (error) {
      if (actor.current.epoch !== current.epoch) return local.saved;
      setPhase(error instanceof ProfileConflict ? "conflict" : "error");
      setMessage(`${error instanceof Error ? error.message : "云端保存失败。"}${local.saved ? " 本次输入已保留在浏览器。" : ` ${local.warning}`}`);
      if (error instanceof ProfileConflict) {
        setRemote(null); remoteRef.current = null; remoteKnown.current = false;
        try {
          const latest = await loadCloudProfile(client, current.userId);
          if (actor.current.epoch === current.epoch) { setRemote(latest); remoteRef.current = latest; remoteKnown.current = true; }
        } catch { /* Keep the original conflict and the unsynchronized local copy. */ }
      }
      return local.saved;
    } finally { saving.current = false; setBusy(false); }
  }

  async function refresh() {
    if (!user || saving.current) return;
    if (!unsaved) { await readAccount(user); return; }
    // A failed disk write leaves the only copy of this edit in memory.
    const current = actor.current, client = clientRef.current;
    if (!client) return;
    setBusy(true);
    try {
      const latest = await loadCloudProfile(client, user.id);
      if (actor.current !== current) return;
      remoteKnown.current = true; remoteRef.current = latest; setRemote(latest);
      current.writable = true;
      setPhase(current.revision === (latest?.revision || 0) ? "pending" : "conflict");
      setMessage("已读取云端版本，本次输入仍保留在页面中。请核对并保存。");
    } catch (error) {
      if (actor.current === current) setMessage(error instanceof Error ? error.message : "云端读取失败，本次输入仍保留在页面中。");
    } finally { setBusy(false); }
  }
  function useRemote() {
    if (busy || !user || !remoteKnown.current) return;
    const latest = remoteRef.current;
    actor.current.revision = latest?.revision || 0; actor.current.writable = true;
    setProfile(latest?.profile || DEMO); setSaved(latest?.profile || null); setUnsaved(false); setPhase("ready");
    if (latest) remember({ profile: latest.profile, revision: latest.revision, pending: false, copiedAt: latest.updatedAt }, actor.current.key);
    setMessage("已使用云端档案；之前的浏览器版本保留在本机历史中。");
  }
  async function keepCurrent() {
    if (!remoteKnown.current || busy) return;
    // Rebase only after an explicit user choice; the server still checks for a newer concurrent save.
    actor.current.revision = remoteRef.current?.revision || 0; actor.current.writable = true;
    await save(profile, true);
  }
  async function login(email: string, password: string, signup: boolean) {
    const client = clientRef.current; if (!client || busy) return;
    setBusy(true); setMessage(""); setAuthNotice("");
    try {
      const { data, error } = signup
        ? await client.auth.signUp({ email, password, options: { emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href } })
        : await client.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.code === "email_address_not_authorized") throw new Error("邮件服务仅允许指定邮箱注册。请联系站点管理员配置注册邮件，或由管理员建立账号。");
        if (error.code === "email_not_confirmed") throw new Error("请先打开注册邮件确认邮箱，再登录。");
        if (error.code === "over_email_send_rate_limit" || error.status === 429) throw new Error("邮件发送过于频繁，请稍后再试。");
        throw new Error(signup ? "注册未完成，请核对邮箱和密码，或稍后再试。" : "登录失败，请核对邮箱和密码。");
      }
      if (signup && !data.session) setMessage("已提交注册。请打开确认邮件验证邮箱，再回来登录；密码不保存在网站代码中。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "账号操作未完成。"); }
    finally { setBusy(false); }
  }
  async function logout() {
    if (!clientRef.current || busy) return;
    if (unsaved) { setMessage("本次输入还未保存，请先重试保存或导出备份，再退出账号。"); return; }
    setBusy(true);
    try {
      const { error } = await clientRef.current.auth.signOut({ scope: "local" });
      if (error) throw error;
      setMessage("已退出这台设备的数据库账号，云端档案保留。");
    } catch { setMessage("退出未成功，请检查连接后重试。"); } finally { setBusy(false); }
  }
  async function readHistory() {
    if (!clientRef.current || !user || busy) return;
    const epoch = actor.current.epoch; setBusy(true);
    try { const rows = await loadCloudHistory(clientRef.current, user.id); if (actor.current.epoch === epoch) setHistory(rows); }
    catch (error) { setMessage(error instanceof Error ? error.message : "读取历史失败。"); }
    finally { setBusy(false); }
  }
  function configure(value: unknown) {
    const config = parseCloudConfig(value); if (!config) throw new Error("请填写数据库配置。");
    localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(config)); window.location.reload();
  }
  const editBase: EditBase | null = phase === "starting" || phase === "loading" || busy || actor.current.userId !== (user?.id || "")
    ? null : { key: actor.current.key, revision: actor.current.revision };
  return { profile, saved, phase, user, configured, busy, unsaved, message, remote, guest, history, localCopies, editBase,
    returningFromEmail: !!confirmation, authNotice, canResolveConflict: remoteKnown.current,
    save, refresh, useRemote, keepCurrent, login, logout, readHistory, configure,
    setRisk: (risk: Profile["risk"]) => { if (profile.mode === "personal") void save({ ...profile, risk }); else setProfile({ ...profile, risk }); },
    showDemo: () => setProfile(DEMO), restoreSaved: () => { if (saved) setProfile(saved); },
  };
}
