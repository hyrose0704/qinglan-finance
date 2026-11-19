import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { LOCAL_ASSISTANT_ORIGIN } from "../lib/local-protocol.ts";

const ISSUER = "https://auth.openai.com", RESOURCE = "https://api.openai.com/v1";
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const random = () => randomBytes(32).toString("base64url");
const equal = (a, b) => typeof a === "string" && typeof b === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class LocalAIError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export async function readResponseStream(body, signal) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = "", output = "", completed = false;
  function consume(frame) {
    const source = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!source || source === "[DONE]") return;
    let event; try { event = JSON.parse(source); } catch { throw new LocalAIError("模型返回了无法解析的数据流。", 502); }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") output += event.delta;
    if (output.length > 60000) throw new LocalAIError("回答超过本次长度限制，请缩小问题后重试。", 502);
    if (event.type === "response.completed") {
      completed = true;
      if (!output) output = (event.response?.output || []).flatMap(item => item.type === "message" ? item.content || [] : [])
        .filter(item => item.type === "output_text").map(item => item.text || "").join("\n");
    }
    if (event.type === "response.failed" || event.type === "error") {
      const code = event.response?.error?.code || event.code;
      const limited = ["subscription_sharing_usage_limit_exceeded", "subscription_sharing_usage_unavailable"].includes(code);
      throw new LocalAIError(limited ? "当前 ChatGPT 套餐使用受限，请在 ChatGPT 用量设置中核对授权和限额。" : "模型未能完成回答，请稍后手动重试。", limited ? 429 : 502);
    }
    if (event.type === "response.incomplete") throw new LocalAIError("模型回答未完整结束，请保留问题后重试。", 502);
  }
  try {
    while (true) {
      if (signal?.aborted) throw new LocalAIError("已停止等待。", 499);
      const { value, done } = await reader.read();
      buffer = (buffer + decoder.decode(value || new Uint8Array(), { stream: !done })).replace(/\r\n/g, "\n");
      if (buffer.length > 300000) throw new LocalAIError("模型数据流过大。", 502);
      let boundary; while ((boundary = buffer.indexOf("\n\n")) >= 0) { consume(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
      if (completed) break;
      if (done) { if (buffer.trim()) consume(buffer); break; }
    }
    if (!completed || !output.trim()) throw new LocalAIError("连接已结束，但没有收到完整回答。", 502);
    if (output.length > 60000) throw new LocalAIError("回答超过本次长度限制。", 502);
    return output.trim();
  } finally { await reader.cancel().catch(() => {}); }
}

export class OpenAIAccounts {
  constructor(store, { fetcher = fetch, verifyToken } = {}) {
    this.store = store; this.fetcher = fetcher; this.pending = new Map(); this.logins = new Map(); this.refreshes = new Map(); this.models = new Map();
    this.verifyToken = verifyToken || (async (token, audience) => {
      const discovery = await this.discovery();
      this.jwks ||= createRemoteJWKSet(new URL(discovery.jwks_uri));
      const result = await jwtVerify(token, this.jwks, { issuer: ISSUER, audience, requiredClaims: ["exp", "sub"], clockTolerance: 30 });
      return result.payload;
    });
  }
  async discovery() {
    if (this.configuration) return this.configuration;
    const response = await this.fetcher(`${ISSUER}/.well-known/openid-configuration`, { redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new LocalAIError("无法读取 OpenAI 官方授权配置。", 502);
    const data = await response.json();
    if (data.issuer !== ISSUER) throw new LocalAIError("官方授权配置的签发方不匹配。", 502);
    for (const field of ["authorization_endpoint", "token_endpoint", "jwks_uri", "revocation_endpoint"]) {
      if (field === "revocation_endpoint" && !data[field]) continue;
      const url = new URL(data[field]); if (url.origin !== ISSUER || url.username || url.password) throw new LocalAIError("授权服务地址不符合预期。", 502);
    }
    this.configuration = data; return data;
  }
  async status(session) {
    const data = await this.store.read(); const login = this.logins.get(session) || null;
    if (login?.pending && login.expiresAt <= Date.now()) { login.pending = false; login.error = "登录等待已超时，请重新开始官方登录。"; }
    return { accounts: data.accounts.map(account => ({ id: account.id, email: account.email || "待完成授权",
      plan: account.plan || "", connected: !!account.accessToken, sharing: !!account.scopes?.includes("chatgpt.tokens.use.direct"),
      lastCompletedAt: account.lastCompletedAt || "" })), login: login ? { pending: login.expiresAt > Date.now() && login.pending, error: login.error || "", accountId: login.accountId || "" } : null };
  }
  async startLogin(session, origin, profileId) {
    const data = await this.store.read();
    const account = profileId ? data.accounts.find(item => item.id === profileId) : null;
    if (profileId && !account) throw new LocalAIError("未找到所选本机账号。");
    const configuration = await this.discovery();
    for (const [state, pending] of this.pending) if (pending.expiresAt < Date.now()) this.pending.delete(state);
    if (this.pending.size >= 10) throw new LocalAIError("待处理登录过多，请稍后重试。", 429);
    const state = random(), verifier = random(), nonce = random();
    const pending = { state, verifier, nonce, accountId: account?.id || randomUUID(), clientId: account?.clientId || "dynamic_agent_client",
      subject: account?.subject || "", session, origin, expiresAt: Date.now() + 5 * 60_000 };
    this.pending.set(state, pending); this.logins.set(session, { pending: true, accountId: pending.accountId, expiresAt: pending.expiresAt, error: "" });
    const url = new URL(configuration.authorization_endpoint);
    const params = { client_id: pending.clientId, ext_agent_host_id: data.hostId, response_type: "code",
      redirect_uri: `${LOCAL_ASSISTANT_ORIGIN}/auth/callback`, scope: SCOPES, resource: RESOURCE,
      state, nonce, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") };
    if (!account) params.agent_name_hint = "青览本地理财助手";
    if (account?.email) params.login_hint = account.email;
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return { authUrl: url.toString() };
  }
  async callback(query) {
    const pending = this.pending.get(query.get("state"));
    if (!pending || !equal(pending.state, query.get("state")) || pending.expiresAt < Date.now()) throw new LocalAIError("登录回调已过期或不匹配，请从青览重新开始登录。");
    this.pending.delete(pending.state);
    try {
      if (query.has("error")) throw new LocalAIError("登录未获授权，可以回到青览重新选择账号。");
      const returnedId = query.get("client_id");
      const clientId = pending.clientId === "dynamic_agent_client" ? returnedId : pending.clientId;
      if (!clientId || clientId === "dynamic_agent_client" || !/^[\w-]{1,256}$/.test(clientId)
        || (pending.clientId !== "dynamic_agent_client" && returnedId && returnedId !== pending.clientId)) throw new LocalAIError("登录返回的客户端标识不匹配。");
      const code = query.get("code"); if (!code || code.length > 10000) throw new LocalAIError("登录回调没有有效授权码。");
      await this.store.update(data => {
        if (!data.accounts.some(account => account.id === pending.accountId)) data.accounts.push({ id: pending.accountId, clientId, email: "", subject: "", scopes: [] });
      });
      const tokens = await this.tokenRequest({ grant_type: "authorization_code", client_id: clientId, code,
        code_verifier: pending.verifier, redirect_uri: `${LOCAL_ASSISTANT_ORIGIN}/auth/callback`, resource: RESOURCE });
      if (!tokens.id_token) throw new LocalAIError("授权响应缺少可验证的身份信息。");
      const identity = await this.verifyToken(tokens.id_token, clientId);
      if (!equal(identity.nonce, pending.nonce) || !identity.sub || (pending.subject && identity.sub !== pending.subject)) throw new LocalAIError("登录身份或随机校验值不匹配，请重新登录。");
      const plan = identity["https://api.openai.com/auth"]?.chatgpt_plan_type || identity.chatgpt_plan_type || "";
      await this.store.update(data => {
        const index = data.accounts.findIndex(account => account.id === pending.accountId);
        data.accounts[index] = { ...data.accounts[index], clientId, subject: identity.sub,
          email: typeof identity.email === "string" ? identity.email.slice(0, 200) : "已授权账号",
          plan: typeof plan === "string" ? plan.slice(0, 50) : "", ...this.credentials(tokens) };
      });
      this.logins.set(pending.session, { pending: false, accountId: pending.accountId, expiresAt: pending.expiresAt, error: "" });
      return { origin: pending.origin, success: true };
    } catch (error) {
      const message = error instanceof LocalAIError ? error.message : "登录验证失败，请返回青览重新授权。";
      this.logins.set(pending.session, { pending: false, accountId: pending.accountId, expiresAt: pending.expiresAt, error: message });
      return { origin: pending.origin, success: false, error: message };
    }
  }
  credentials(tokens) {
    if (typeof tokens.access_token !== "string" || !tokens.access_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new LocalAIError("官方授权响应中的凭证或有效期无效。", 502);
    return { accessToken: tokens.access_token, refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : "",
      expiresAt: Date.now() + tokens.expires_in * 1000, scopes: String(tokens.scope || "").split(" ").filter(Boolean) };
  }
  async tokenRequest(fields) {
    const configuration = await this.discovery();
    const response = await this.fetcher(configuration.token_endpoint, { method: "POST", body: new URLSearchParams(fields),
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, redirect: "error", signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new LocalAIError("官方授权未完成或已失效，请重新登录账号。", 401);
    return response.json();
  }
  async access(accountId) {
    let account = (await this.store.read()).accounts.find(item => item.id === accountId);
    if (!account?.accessToken) throw new LocalAIError("请先在本机登录所选账号。", 401);
    if (account.expiresAt < Date.now() + 120000) {
      if (!account.refreshToken) throw new LocalAIError("账号授权已过期，请重新登录。", 401);
      if (!this.refreshes.has(accountId)) {
        const refresh = (async () => {
          const tokens = await this.tokenRequest({ grant_type: "refresh_token", client_id: account.clientId,
            refresh_token: account.refreshToken, resource: RESOURCE });
          if (tokens.id_token) {
            const identity = await this.verifyToken(tokens.id_token, account.clientId);
            if (identity.sub !== account.subject) throw new LocalAIError("续期返回的账号身份不匹配，请重新登录。", 401);
          }
          const credentials = this.credentials({ ...tokens, refresh_token: tokens.refresh_token || account.refreshToken,
            scope: tokens.scope || account.scopes.join(" ") });
          await this.store.update(data => { Object.assign(data.accounts.find(item => item.id === accountId), credentials); });
        })().finally(() => this.refreshes.delete(accountId));
        this.refreshes.set(accountId, refresh);
      }
      await this.refreshes.get(accountId); account = (await this.store.read()).accounts.find(item => item.id === accountId);
    }
    if (!account.scopes.includes("chatgpt.tokens.use.direct")) throw new LocalAIError("账号已登录，但尚未允许青览使用 ChatGPT 套餐，请重新授权。", 403);
    return account;
  }
  async listModels(accountId) {
    const account = await this.access(accountId), cached = this.models.get(accountId);
    if (cached && cached.expiresAt > Date.now()) return cached.models;
    const response = await this.fetcher(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${account.accessToken}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new LocalAIError("无法读取该账号的模型，请核对授权与套餐访问范围。", response.status === 401 ? 401 : 502);
    const data = await response.json();
    const models = (Array.isArray(data.models) ? data.models : []).filter(model => model.visibility === "list" && typeof model.slug === "string")
      .slice(0, 100).map(model => ({ id: model.slug, name: model.display_name || model.slug }));
    if (!models.length) throw new LocalAIError("官方没有返回可展示的账号模型。", 502);
    this.models.set(accountId, { models, expiresAt: Date.now() + 60000 }); return models;
  }
  async respond(accountId, model, messages, signal) {
    const models = await this.listModels(accountId);
    if (!models.some(item => item.id === model)) throw new LocalAIError("请从该账号返回的模型列表中选择模型。");
    if (!Array.isArray(messages) || messages.length > 16 || messages.some(item => !["system", "user", "assistant"].includes(item.role) || typeof item.content !== "string" || item.content.length > 26000)) throw new LocalAIError("问题或上下文格式无效。");
    const account = await this.access(accountId);
    const response = await this.fetcher(`${RESOURCE}/responses`, { method: "POST", headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, instructions: messages.filter(item => item.role === "system").map(item => item.content).join("\n"),
        input: messages.filter(item => item.role !== "system").map(item => ({ role: item.role, content: item.content })), store: false, stream: true }),
      redirect: "error", signal });
    if (!response.ok) throw new LocalAIError(response.status === 401 ? "账号授权已失效，请重新登录。" : response.status === 429 ? "套餐用量或请求频率受限，请核对 ChatGPT 用量设置。" : "官方模型服务暂未完成请求，请稍后手动重试。", response.status === 401 ? 401 : 502);
    if (!response.body) throw new LocalAIError("模型响应没有可读取的数据流。", 502);
    const content = await readResponseStream(response.body, signal);
    await this.store.update(data => { data.accounts.find(item => item.id === accountId).lastCompletedAt = new Date().toISOString(); });
    return { content, truncated: false };
  }
  async disconnect(accountId) {
    const account = (await this.store.read()).accounts.find(item => item.id === accountId);
    if (!account) throw new LocalAIError("未找到所选账号。");
    let revoked = !account.refreshToken;
    try {
      const configuration = await this.discovery();
      if (account.refreshToken && configuration.revocation_endpoint) {
        const response = await this.fetcher(configuration.revocation_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: account.refreshToken, token_type_hint: "refresh_token", client_id: account.clientId }), redirect: "error", signal: AbortSignal.timeout(15000) });
        revoked = response.ok;
      }
    } catch { /* The local sign-out still clears credentials when remote revocation is unavailable. */ }
    await this.store.update(data => { const item = data.accounts.find(value => value.id === accountId); delete item.accessToken; delete item.refreshToken; item.scopes = []; item.expiresAt = 0; });
    this.models.delete(accountId); return { revoked };
  }
}
