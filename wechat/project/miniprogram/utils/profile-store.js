const {
  EMPTY_PROFILE, PROFILE_KEY, profileScope, readProfileCopy, writeProfileCopy,
  reconcileProfiles, personalProfile, readCloudRow, draftRevision,
} = require("./shared.js");

function createProfileStore(config, storage, request) {
  const sessionKey = "qinglan-wechat-session-v1:" + config.url;
  const listeners = new Set();
  let session = null;
  let copy = readProfileCopy(storage).copy;
  let remote = null;
  let checked = false;
  let lastRead = 0;
  let memoryOnly = false;
  let state = { phase: "starting", busy: false, notice: "" };

  function scope() {
    return session ? profileScope(config.url, session.user.id) : PROFILE_KEY;
  }

  function snapshot() {
    return {
      ...state, profile: copy?.profile || EMPTY_PROFILE, hasProfile: !!copy,
      email: session?.user.email || "", signedIn: !!session, revision: copy?.revision || 0,
      hasPending: copy?.pending === true, remoteRevision: checked ? remote?.revision || 0 : null,
      remote: checked ? remote : null,
      canImport: !!session && state.phase === "ready" && !copy && !!readProfileCopy(storage).copy,
    };
  }

  function emit(changes) {
    state = { ...state, ...changes };
    const current = snapshot();
    for (const listener of listeners) listener(current);
  }

  function remember(item) {
    copy = item;
    const result = writeProfileCopy(storage, item, scope());
    memoryOnly = !result.saved;
    if (!result.saved) return "本机存储失败，本次输入仍在当前小程序中。";
    return result.warning ? "本机备份只写入了一份。" : "";
  }

  async function run(operation, failed) {
    if (state.busy) return false;
    emit({ busy: true, notice: "" });
    try {
      return await operation();
    } catch (error) {
      emit({ phase: failed || state.phase, notice: error.message || "账号操作未完成。" });
      return false;
    } finally {
      emit({ busy: false });
    }
  }

  function api(path, method = "GET", data, token) {
    const headers = { apikey: config.publishableKey, "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    return request(config.url + path, { method, data, headers });
  }

  function readSession(value) {
    if (!value || typeof value !== "object"
      || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value.user?.id || "")
      || typeof value.access_token !== "string" || !value.access_token
      || typeof value.refresh_token !== "string" || !value.refresh_token) return null;
    const expiresAt = value.expires_at || Date.now() / 1000 + Number(value.expires_in);
    if (!Number.isFinite(expiresAt)) return null;
    return {
      access_token: value.access_token, refresh_token: value.refresh_token, expires_at: expiresAt,
      user: { id: value.user.id, email: typeof value.user.email === "string" ? value.user.email : "" },
    };
  }

  function setSession(value) {
    session = value;
    try {
      storage.setItem(sessionKey, value ? JSON.stringify(value) : "");
      return true;
    } catch {
      return false;
    }
  }

  async function refreshToken() {
    try {
      const data = await api("/auth/v1/token?grant_type=refresh_token", "POST", { refresh_token: session.refresh_token });
      const refreshed = readSession(data);
      if (!refreshed || refreshed.user.id !== session.user.id) throw new Error("无法确认当前登录账号。");
      setSession(refreshed);
    } catch (error) {
      if (error.status === 400 || error.status === 401 || error.status === 403) {
        const expired = new Error("登录已过期，请用相同邮箱重新登录。");
        expired.expired = true;
        throw expired;
      }
      throw error;
    }
  }

  async function authenticated(path, method, data) {
    if (session.expires_at <= Date.now() / 1000 + 60) await refreshToken();
    try {
      return await api(path, method, data, session.access_token);
    } catch (error) {
      if (error.status !== 401) throw error;
      await refreshToken();
      return api(path, method, data, session.access_token);
    }
  }

  async function loadAccount() {
    checked = false;
    try {
      const rows = await authenticated(
        "/rest/v1/qinglan_profiles?select=profile,revision,updated_at&user_id=eq." + encodeURIComponent(session.user.id),
      );
      if (!Array.isArray(rows) || rows.length > 1) throw new Error("云端档案格式无法读取。");
      remote = rows.length ? readCloudRow(rows[0]) : null;
      checked = true;
      lastRead = Date.now();
      const result = reconcileProfiles(copy, remote);
      if (result.action === "remote") {
        const warning = remote ? remember({
          profile: remote.profile, pending: false, revision: remote.revision, copiedAt: remote.updatedAt,
        }) : "";
        if (!remote) { copy = null; memoryOnly = false; }
        emit({ phase: "ready", notice: warning });
      } else {
        emit({ phase: result.action, notice: result.action === "conflict"
          ? "本机和云端都有更新，请比较后选择。" : "本机还有待同步的档案。" });
      }
      return true;
    } catch (error) {
      const notice = error.code === "PGRST205" || error.code === "42P01"
        ? "云数据库尚未初始化。" : error.message;
      emit({ phase: error.expired ? "expired" : "offline", notice: notice + (copy ? " 当前显示这台设备保存的账号副本。" : "") });
      return false;
    }
  }

  async function restore() {
    try { session = readSession(JSON.parse(storage.getItem(sessionKey) || "null")); } catch { session = null; }
    if (!session) { emit({ phase: "signed-out" }); return true; }
    copy = readProfileCopy(storage, scope()).copy;
    return run(loadAccount, "offline");
  }

  async function signIn(email, password) {
    return run(async () => {
      const address = email.trim();
      if (!address || !password) throw new Error("请输入已有青览账号的邮箱和密码。");
      if (memoryOnly && copy && !session) throw new Error("请先保存本机档案，再登录云端账号。");
      let parsed;
      try {
        parsed = readSession(await api("/auth/v1/token?grant_type=password", "POST", { email: address, password }));
      } catch (error) {
        if (error.code === "email_not_confirmed") throw new Error("请先打开确认邮件验证邮箱。");
        if (error.status === 400 || error.status === 401) throw new Error("登录失败，请核对邮箱和密码。");
        throw error;
      }
      if (!parsed) throw new Error("没有取得可用的登录凭证。");
      if (memoryOnly && copy?.pending && parsed.user.id !== session?.user.id) throw new Error("请先保存当前账号的输入，再切换账号。");
      const sameAccount = parsed.user.id === session?.user.id;
      const persisted = setSession(parsed);
      if (!sameAccount) { copy = readProfileCopy(storage, scope()).copy; memoryOnly = false; }
      await loadAccount();
      if (!persisted) emit({ notice: state.notice + " 下次打开小程序可能需要重新登录。" });
      return true;
    });
  }

  async function signOut() {
    return run(async () => {
      if (!session) return true;
      if (memoryOnly && copy?.pending) throw new Error("请先重试保存本次输入，再退出。");
      const previous = session;
      if (!setSession(null)) {
        session = previous;
        throw new Error("无法清除本机登录记录，请重试。");
      }
      checked = false; remote = null; lastRead = 0;
      copy = readProfileCopy(storage).copy; memoryOnly = false;
      emit({ phase: "signed-out", notice: "已退出这台设备的青览账号。" });
      try { await api("/auth/v1/logout?scope=local", "POST", undefined, previous.access_token); } catch { /* Local sign-out already completed. */ }
      return true;
    });
  }

  async function push(profile, revision) {
    try {
      const row = await authenticated("/rest/v1/rpc/qinglan_save_profile", "POST", {
        p_profile: profile, p_expected_revision: revision, p_expected_user_id: session.user.id,
      });
      remote = readCloudRow(row); checked = true; lastRead = Date.now();
      const warning = remember({ profile: remote.profile, pending: false, revision: remote.revision, copiedAt: remote.updatedAt });
      emit({ phase: "ready", notice: "已同步云端 · 第 " + remote.revision + " 版。" + warning });
      return true;
    } catch (error) {
      if (error.code === "QF409") {
        await loadAccount();
        if (state.phase === "ready") return true; // The same write may have committed before its response was lost.
      } else {
        emit({ phase: error.expired ? "expired" : "offline", notice: (memoryOnly ? "本次输入尚未保存。" : "本机副本已保存，等待同步。") + error.message });
      }
      return !memoryOnly;
    }
  }

  function editBase() { return { key: scope(), revision: copy?.revision || 0 }; }

  async function save(input, base) {
    return run(async () => {
      const current = editBase();
      const revision = draftRevision(current, base);
      const profile = personalProfile(input);
      const copiedAt = new Date().toISOString();
      const warning = remember({ profile, revision, copiedAt, pending: !!session });
      if (!session) {
        emit({ notice: (memoryOnly ? "" : "已保存到这台设备。") + warning });
        return !memoryOnly;
      }
      if (revision !== current.revision || (checked && revision !== (remote?.revision || 0))) {
        emit({ phase: "conflict", notice: "编辑期间档案有更新，请比较本次输入和云端版本。" + warning });
        return !memoryOnly;
      }
      if (!checked) {
        emit({ notice: (memoryOnly ? "" : "已保存本机副本，读取云端后可同步。") + warning });
        return !memoryOnly;
      }
      return push(profile, revision);
    });
  }

  async function keepLocal(reviewedRevision) {
    return run(async () => {
      if (!session || !copy?.pending) return false;
      if (!checked) {
        await loadAccount();
        if (state.phase === "conflict") return false;
        if (state.phase === "ready") return true;
      }
      if (!checked) return false;
      const profile = copy.profile;
      const revision = remote?.revision || 0;
      if (state.phase === "conflict" && reviewedRevision !== revision) {
        emit({ notice: "云端版本有更新，请重新比较后再确认。" });
        return false;
      }
      remember({ profile, revision, copiedAt: new Date().toISOString(), pending: true });
      return push(profile, revision);
    });
  }

  function useCloud(reviewedRevision) {
    if (!session || !checked || !remote || state.busy) return false;
    if (remote.revision !== reviewedRevision) {
      emit({ notice: "云端版本有更新，请重新比较后再确认。" });
      return false;
    }
    const warning = remember({ profile: remote.profile, revision: remote.revision, pending: false, copiedAt: remote.updatedAt });
    emit({ phase: "ready", notice: "已采用云端档案。" + warning });
    return true;
  }

  async function importLocal() {
    if (!snapshot().canImport) return false;
    const guest = readProfileCopy(storage).copy;
    return guest ? save(guest.profile, editBase()) : false;
  }

  return {
    snapshot, editBase, restore, signIn, signOut, save, useCloud, keepLocal, importLocal,
    refresh: () => session && run(loadAccount, "offline"),
    refreshIfStale: () => session && Date.now() - lastRead > 60000 && state.phase !== "expired" && run(loadAccount, "offline"),
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  };
}

module.exports = { createProfileStore };
