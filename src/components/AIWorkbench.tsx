import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, CircleHelp, Eye, EyeOff, KeyRound, LockKeyhole, MessageSquare, Save, Send, ShieldCheck, Square, Trash2 } from "lucide-react";
import { EMPTY_PREFERENCES, readPreferences } from "@/lib/allocation";
import { AI_INPUTS_KEY, AIServiceError, askDeepseek, buildSiteContext, createChatMessages, listDeepseekModels,
  MAX_TURNS, readAIInputs, serializeAIInputs, type AIInputs, type AIModel } from "@/lib/ai";
import { AI_VAULT_KEY, decryptApiKey, encryptApiKey, normalizeApiKey, readEncryptedApiKey, type EncryptedApiKey } from "@/lib/ai-vault";
import type { Profile, calculate } from "@/lib/finance";
import { LocalAccountCard } from "./LocalAccountCard";
import { useLocalAssistant } from "./useLocalAssistant";
import { LocalClientError } from "@/lib/local-client";
import "../assistant.css";

interface Props {
  active: boolean;
  profile: Profile;
  balances: ReturnType<typeof calculate>;
  privacy: boolean;
  showAmounts: () => void;
  accountMode?: boolean;
  openAssistant: () => void;
}

function loadInputs() {
  try {
    const raw = localStorage.getItem(AI_INPUTS_KEY);
    if (raw && raw.length > 400000) throw new Error();
    const value = raw ? JSON.parse(raw) : null;
    if (value && value.version !== 1) throw new Error();
    return { record: readAIInputs(value), error: "" };
  } catch { return { record: readAIInputs(null), error: "无法读取助手输入。当前草稿仍可使用，保存时会重新尝试。" }; }
}

function loadVault() {
  try {
    const raw = localStorage.getItem(AI_VAULT_KEY);
    if (raw && raw.length > 10000) throw new Error();
    return { record: raw ? readEncryptedApiKey(JSON.parse(raw)) : null, error: "" };
  } catch { return { record: null, error: "无法读取本地 Key 记录。可以删除记录后重新连接。" }; }
}

function savedTime(value: string) {
  return value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "";
}

export function AIWorkbench({ active, profile, balances, privacy, showAmounts, accountMode = false, openAssistant }: Props) {
  const local = useLocalAssistant();
  const [initialInputs] = useState(loadInputs), [initialVault] = useState(loadVault);
  const [inputs, setInputs] = useState<AIInputs>(initialInputs.record);
  const [saved, setSaved] = useState(serializeAIInputs(initialInputs.record));
  const [saveError, setSaveError] = useState(initialInputs.error);
  const [saveNotice, setSaveNotice] = useState("");
  const [vault, setVault] = useState<EncryptedApiKey | null>(initialVault.record);
  const [vaultError, setVaultError] = useState(initialVault.error);
  const [credential, setCredential] = useState<{ key: string; models: AIModel[] } | null>(null);
  const [keySaved, setKeySaved] = useState(false);
  const [keyInput, setKeyInput] = useState(""), [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true), [showKey, setShowKey] = useState(false), [replaceKey, setReplaceKey] = useState(false);
  const [connecting, setConnecting] = useState(false), [connectionError, setConnectionError] = useState("");
  const [connectionNotice, setConnectionNotice] = useState("");
  const [preferences, setPreferences] = useState(EMPTY_PREFERENCES), [preferencesError, setPreferencesError] = useState("");
  const [pending, setPending] = useState(""), [answerError, setAnswerError] = useState("");
  const [answerNotice, setAnswerNotice] = useState("");
  const connectionRequest = useRef<AbortController | null>(null), chatRequest = useRef<AbortController | null>(null);
  const dirty = serializeAIInputs(inputs) !== saved;
  const providerLabel = inputs.provider === "chatgpt-local" ? "ChatGPT" : "DeepSeek";
  const ready = inputs.provider === "chatgpt-local" ? local.connected && !!local.account?.sharing && !!local.models.length : !!credential;
  const siteContext = useMemo(() => buildSiteContext(profile, balances, preferences), [profile, balances, preferences]);

  useEffect(() => {
    if (!active) return;
    try {
      const raw = localStorage.getItem("qinglan-planning-v1");
      setPreferences(readPreferences(raw ? JSON.parse(raw) : null)); setPreferencesError("");
    } catch {
      setPreferences(EMPTY_PREFERENCES); setPreferencesError("规划条件读取失败，摘要将其标为未填写。");
    }
  }, [active]);
  useEffect(() => () => { connectionRequest.current?.abort(); chatRequest.current?.abort(); }, []);
  useEffect(() => {
    if (local.models.length && !local.models.some(model => model.id === inputs.chatgptModel)) {
      setInputs(previous => ({ ...previous, chatgptModel: local.models[0].id }));
    }
  }, [local.models, inputs.chatgptModel]);

  function updateInputs(change: Partial<AIInputs>) { setInputs(previous => ({ ...previous, ...change })); setSaveNotice(""); }

  function saveInputs() {
    const next = readAIInputs({ ...inputs, savedAt: new Date().toISOString() });
    try {
      const serialized = serializeAIInputs(next);
      localStorage.setItem(AI_INPUTS_KEY, serialized); setInputs(next); setSaved(serialized);
      setSaveError(""); setSaveNotice("补充背景、问题草稿、最近对话和发送设置已保存在当前浏览器。");
    } catch { setSaveError("保存失败，当前输入仍保留在页面中。请检查浏览器存储空间或隐私设置。"); }
  }

  function restoreInputs() {
    const loaded = loadInputs();
    if (loaded.error) { setSaveError(loaded.error); return; }
    const model = credential && !credential.models.some(item => item.id === loaded.record.model)
      ? credential.models[0].id : loaded.record.model;
    setInputs({ ...loaded.record, model }); setSaved(serializeAIInputs(loaded.record)); setSaveError("");
    setSaveNotice("已恢复上次保存的助手输入。"); setAnswerError(""); setAnswerNotice("");
  }

  async function connect(event: FormEvent) {
    event.preventDefault(); if (connecting) return;
    const request = new AbortController(); connectionRequest.current = request;
    setConnecting(true); setConnectionError(""); setConnectionNotice("");
    try {
      const unlocking = !!vault && !replaceKey;
      const key = unlocking ? await decryptApiKey(vault, password) : normalizeApiKey(keyInput);
      const encrypted = !unlocking && remember ? await encryptApiKey(key, password) : null;
      const models = await listDeepseekModels(key, request.signal);
      setCredential({ key, models });
      setKeySaved(unlocking);
      const model = models.find(item => item.id === inputs.model)?.id
        || models.find(item => item.id === "deepseek-flash")?.id || models[0].id;
      setInputs(previous => ({ ...previous, model }));
      if (!unlocking) {
        try {
          if (encrypted) localStorage.setItem(AI_VAULT_KEY, JSON.stringify(encrypted));
          else localStorage.removeItem(AI_VAULT_KEY);
          setVault(encrypted); setKeySaved(!!encrypted); setVaultError("");
        } catch { setVaultError("Key 已验证，但浏览器未能更新保存记录。本次连接仅在当前页面有效，旧记录可能仍在。"); }
      }
      setKeyInput(""); setPassword(""); setShowKey(false); setReplaceKey(false);
      setConnectionNotice("Key 已通过模型列表验证。能否生成回答仍取决于账户额度与模型权限。");
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "连接失败，请检查 Key 后重试。");
    } finally { setConnecting(false); connectionRequest.current = null; }
  }

  function lockConnection() {
    connectionRequest.current?.abort(); chatRequest.current?.abort(); setCredential(null); setKeySaved(false);
    setKeyInput(""); setPassword(""); setShowKey(false); setConnectionNotice(""); setConnectionError("");
  }

  function forgetKey() {
    try {
      localStorage.removeItem(AI_VAULT_KEY); lockConnection(); setVault(null); setVaultError(""); setReplaceKey(false);
      setConnectionNotice("已删除当前浏览器的 Key 记录。");
    } catch { setVaultError("浏览器未能删除 Key 记录，请在网站存储设置中处理。"); }
  }

  async function sendQuestion(event: FormEvent) {
    event.preventDefault();
    if (!ready || pending || !inputs.draft.trim()) return;
    const useLocal = inputs.provider === "chatgpt-local";
    if (!(useLocal ? local.models.some(model => model.id === inputs.chatgptModel) : credential?.models.some(model => model.id === inputs.model))) { setAnswerError("请先选择已读取的模型。"); return; }
    const question = inputs.draft.trim(), history = inputs.messages;
    const messages = createChatMessages({ question, notes: inputs.notes, history, siteContext, includeSiteData: inputs.includeSiteData });
    const request = new AbortController(); chatRequest.current = request;
    setPending(question); setAnswerError(""); setAnswerNotice("");
    try {
      const response = useLocal ? await local.ask(inputs.chatgptModel, messages, request.signal)
        : await askDeepseek({ key: credential!.key, model: inputs.model, messages, signal: request.signal });
      setInputs(previous => ({ ...previous, draft: "", messages: [...history,
        { role: "user" as const, content: question }, { role: "assistant" as const, content: response.content, provider: providerLabel as "DeepSeek" | "ChatGPT" }].slice(-MAX_TURNS) }));
      if (response.truncated) setAnswerNotice("回答达到本次输出长度限制，内容可能尚未完成，可以继续追问。");
    } catch (error) {
      setAnswerError(error instanceof AIServiceError || error instanceof LocalClientError ? error.message : "回答未完成，请保留草稿后手动重试。");
      if (error instanceof AIServiceError && error.status === 401) setCredential(null);
    } finally { setPending(""); chatRequest.current = null; }
  }

  return <div className="ai-workbench" hidden={!active}>
    <section className="ai-intro">
      <div><span className="eyebrow">你的资料，让解释更有依据</span><h2>{accountMode ? "管理你的 AI 账号。" : "带着上下文，讨论你的资金安排。"}</h2>
        <p>选择本机 ChatGPT 套餐账号或自己的 DeepSeek Key，结合已保存档案、规划条件、补充背景与最近6轮对话提问。</p></div>
      <div className="ai-save-actions">{accountMode && <button className="button secondary" onClick={openAssistant}>打开 AI 助手</button>}<button className="button primary" onClick={saveInputs} disabled={!!pending}><Save size={17} />保存输入</button>
        <span>{dirty ? "有未保存的输入" : inputs.savedAt ? `已保存 ${savedTime(inputs.savedAt)}（北京时间）` : "尚未保存助手输入"}</span></div>
    </section>
    {saveError && <p className="warning-box" role="alert">{saveError}</p>}
    {saveNotice && <p className="ai-success" role="status"><CheckCircle2 size={17} />{saveNotice}</p>}

    <div className="ai-connections">
      <section className="panel ai-provider" aria-labelledby="deepseek-heading">
        <div className="panel-heading"><h2 id="deepseek-heading"><KeyRound size={19} />DeepSeek Key 连接</h2>
          <span className={`badge ${credential ? "green" : ""}`}>{credential ? "已连接" : vault ? "已保存 · 待解锁" : "未连接"}</span></div>
        <p>Key 只发送给 <strong>api.deepseek.com</strong>，由浏览器直接调用。验证连接会读取模型列表；点击发送问题后，按你的 DeepSeek API 账户计费。</p>
        {credential ? <div className="ai-connected">
          <label className="ai-field"><span>当前模型</span><select aria-label="当前模型" value={inputs.model} disabled={!!pending}
            onChange={event => updateInputs({ model: event.target.value })}>
            {credential.models.map(model => <option value={model.id} key={model.id}>{model.name}</option>)}</select></label>
          <p className="ai-help">{keySaved ? "当前 Key 已加密保存；刷新后需要密码解锁。" : "当前 Key 仅保留在页面内存，关闭或刷新后需重新输入。"}</p>
          <button className="button secondary" onClick={lockConnection}><LockKeyhole size={16} />{vault ? "锁定连接" : "断开连接"}</button>
        </div> : <form className="ai-connection-form" onSubmit={event => void connect(event)}>
          {vault && !replaceKey ? <>
            <label className="ai-field"><span>本地解锁密码</span><input type="password" aria-label="本地解锁密码" autoComplete="current-password"
              value={password} onChange={event => setPassword(event.target.value)} required minLength={8} maxLength={128} disabled={connecting} /></label>
            <p className="ai-help">这是你保存 Key 时设置的本地密码，不是 DeepSeek 账号密码。</p>
          </> : <>
            <label className="ai-field"><span>DeepSeek API Key</span><span className="ai-secret-input">
              <input type={showKey ? "text" : "password"} aria-label="DeepSeek API Key" autoComplete="off" autoCapitalize="none" spellCheck={false}
                value={keyInput} onChange={event => setKeyInput(event.target.value)} required maxLength={512} disabled={connecting} placeholder="粘贴你的 API Key" />
              <button type="button" className="icon-button" aria-label={showKey ? "隐藏 Key" : "显示 Key"} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </span></label>
            <label className="ai-check"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} disabled={connecting} />本地加密保存 Key</label>
            {remember && <label className="ai-field"><span>设置本地解锁密码</span><input type="password" aria-label="设置本地解锁密码" autoComplete="new-password"
              value={password} onChange={event => setPassword(event.target.value)} required minLength={8} maxLength={128} disabled={connecting} />
              <small>8至128个字符。密码不会保存，刷新后用它解锁；忘记后需重新输入 Key。</small></label>}
          </>}
          <div className="ai-actions"><button className="button primary" type="submit" disabled={connecting}>{connecting ? "验证连接中…" : vault && !replaceKey ? "解锁并连接 DeepSeek" : "连接并读取模型"}</button>
            {vault && <button className="text-button" type="button" disabled={connecting} onClick={() => { setReplaceKey(!replaceKey); setPassword(""); setConnectionError(""); }}>{replaceKey ? "返回解锁" : "改用其他 Key"}</button>}</div>
        </form>}
        {connectionError && <p className="warning-box" role="alert">{connectionError}</p>}
        {connectionNotice && <p className="ai-help" role="status">{connectionNotice}</p>}
        {vaultError && <p className="warning-box" role="alert">{vaultError}</p>}
        <div className="ai-provider-footer"><a href="https://api-docs.deepseek.com/" target="_blank" rel="noreferrer">DeepSeek 官方 API 说明</a>
          {(vault || vaultError) && <button className="text-button" onClick={forgetKey} disabled={connecting}><Trash2 size={14} />删除本地 Key 记录</button>}</div>
        <p className="ai-help">Key 不进入资金档案或助手输入备份。解锁后请仅在可信设备使用；本地加密不能防止网页运行时的恶意脚本。</p>
      </section>

      <LocalAccountCard local={local} model={inputs.chatgptModel} selectModel={chatgptModel => updateInputs({ chatgptModel })} />

    </div>

    {!accountMode && (privacy ? <section className="panel ai-private"><LockKeyhole size={23} /><h2>金额隐私已开启</h2>
      <p>暂时隐藏助手输入、对话和资金摘要。显示后可以核对将发送的内容。</p>
      <button className="button secondary" onClick={showAmounts}>显示输入与对话</button></section> : <>
      <section className="panel ai-context" aria-labelledby="context-heading">
        <div className="panel-heading"><h2 id="context-heading"><CircleHelp size={19} />助手使用哪些上下文</h2>
          <span className="badge">{profile.mode === "demo" ? "当前为演示档案" : "读取当前资金档案"}</span></div>
        <p>资金与持仓读取已提交到网页的档案，规划条件读取最近保存值。资产弹窗中尚未提交的修改不包含在内。最近6轮对话会随每次问题提供。</p>
        <label className="ai-check"><input type="checkbox" checked={inputs.includeSiteData} disabled={!!pending}
          onChange={event => updateInputs({ includeSiteData: event.target.checked })} />发送网站资金与规划摘要给 {providerLabel}</label>
        <p className="ai-help">摘要包括现金、收入支出、还款与用款预留、持仓成本、损失承受金额、规划条件和网页计算结果。取消勾选后不附带此摘要。</p>
        <details className="ai-context-preview"><summary>查看当前资金摘要</summary><pre>{siteContext}</pre></details>
        {preferencesError && <p className="warning-box" role="alert">{preferencesError}</p>}
        <label className="ai-field"><span>补充背景</span><textarea aria-label="补充背景" value={inputs.notes} maxLength={4000} rows={4} disabled={!!pending}
          onChange={event => updateInputs({ notes: event.target.value })} placeholder="例如：这笔钱什么时候要用？还有哪些未录入的资产或负债？" />
          <small>发送问题时，这段背景会一并提供给 {providerLabel}。点击顶部“保存输入”后，下次打开会恢复。</small></label>
        <div className="ai-actions"><button className="button secondary" onClick={saveInputs} disabled={!!pending}><Save size={16} />保存输入</button>
          <button className="text-button" onClick={restoreInputs} disabled={!!pending || !inputs.savedAt}>恢复上次保存</button></div>
        <p className="ai-help">保存范围：补充背景、问题草稿、最近对话、模型与发送设置。资金档案和规划条件由各自页面保存；这里的保存只在当前浏览器生效，不会同步到账户或 GitHub。</p>
      </section>

<section className="panel ai-provider-choice"><label className="ai-field"><span>这次使用哪个 AI 账号？</span><select aria-label="这次使用哪个 AI 账号？" value={inputs.provider} disabled={!!pending} onChange={event => updateInputs({ provider: event.target.value as AIInputs["provider"] })}><option value="deepseek">DeepSeek · API Key</option><option value="chatgpt-local">ChatGPT · 本机套餐账号</option></select></label><p className="ai-help">发送问题会使用所选服务及其账号额度。切换服务后，请核对上下文和最近对话是否适合一并提供。</p></section>
      <section className="panel ai-conversation" aria-labelledby="conversation-heading">
        <div className="panel-heading"><h2 id="conversation-heading"><MessageSquare size={19} />与助手讨论</h2>
          <button className="text-button" disabled={!!pending || !inputs.messages.length} onClick={() => { updateInputs({ messages: [] }); setAnswerNotice(""); setAnswerError(""); }}>清空当前对话</button></div>
        <p className="ai-help">当前为 {providerLabel} 文字问答，尚未启用联网搜索。模型回答需要核对，市场数据请以“市场观察”的来源和时间为准。</p>
        {!inputs.messages.length && !pending && <div className="ai-empty"><MessageSquare size={27} /><h3>从你最想弄清楚的问题开始</h3>
          <p>可以解释计算，也可以先让助手找出资料中需要补齐的条件。</p>
          <div className="ai-suggestions">{["根据我的现金流和目标，先列出需要核对的问题。", "帮我解释应急金和可新增投资现金的计算。", "我的持仓有哪些集中风险？"].map(question =>
            <button key={question} onClick={() => updateInputs({ draft: question })}>{question}</button>)}</div></div>}
        <div className="ai-messages" role="log" aria-label="助手对话记录" aria-live="polite">
          {inputs.messages.map((turn, index) => <article key={index} className={`ai-turn ${turn.role}`}><strong>{turn.role === "user" ? "你" : turn.provider || "DeepSeek"}</strong><p>{turn.content}</p></article>)}
          {pending && <><article className="ai-turn user"><strong>你</strong><p>{pending}</p></article><p className="ai-waiting" role="status">{providerLabel} 正在回答…</p></>}
        </div>
        {answerError && <p className="warning-box" role="alert">{answerError}</p>}
        {answerNotice && <p className="warning-box" role="status">{answerNotice}</p>}
        <form className="ai-composer" onSubmit={event => void sendQuestion(event)}>
          <label className="ai-field"><span>你的问题</span><textarea aria-label="你的问题" rows={4} value={inputs.draft} maxLength={2000}
            onChange={event => updateInputs({ draft: event.target.value })} disabled={!!pending} placeholder="输入问题，或先保存草稿再回来继续。" required /></label>
          <div className="ai-composer-bottom"><span>{inputs.draft.length} / 2000 · 点击发送才调用 API</span>
            {pending ? <button type="button" className="button secondary" onClick={() => chatRequest.current?.abort()}><Square size={14} />停止等待</button>
              : <button type="submit" className="button primary" disabled={!ready || !inputs.draft.trim()}><Send size={16} />发送给 {providerLabel}</button>}</div>
          {!ready && <p className="ai-help">先完成所选服务的连接或登录。现在仍可编辑背景、问题并保存到浏览器。</p>}
        </form>
      </section>
    </>)}
  </div>;
}
