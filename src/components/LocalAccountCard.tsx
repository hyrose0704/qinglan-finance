import { ShieldCheck, LogIn, RefreshCw, Unplug } from "lucide-react";
import { LOCAL_ASSISTANT_ORIGIN } from "@/lib/local-protocol";
import type { useLocalAssistant } from "./useLocalAssistant";

export function LocalAccountCard({ local, model, selectModel }: {
  local: ReturnType<typeof useLocalAssistant>; model: string; selectModel: (model: string) => void;
}) {
  return <section className="panel ai-provider ai-chatgpt" aria-labelledby="chatgpt-heading">
    <div className="panel-heading"><h2 id="chatgpt-heading"><ShieldCheck size={19} />ChatGPT 本机账号</h2>
      <span className={`badge ${local.account?.sharing && local.models.length ? "green" : "gold"}`}>{!local.connected ? "待连接本机" : local.account?.sharing && local.models.length ? "账号与模型可用" : "本机已连接"}</span></div>
    <p>通过本机程序进行官方账号授权，使用符合条件的 ChatGPT 套餐。Pro 的实际可用模型和用量以官方账号为准。</p>
    {!local.connected ? <>
      {local.cached && <p className="ai-help">上次选择：{local.cached.email} · 当前尚未连接。</p>}
      <div className="ai-local-steps"><p>先在本机项目目录运行：</p><code>npm run local-assistant</code><p>再连接本机，确认连接后进入 OpenAI 官方页面登录。</p></div>
      <button className="button primary" onClick={() => void local.connect()} disabled={local.busy}><LogIn size={16} />{local.busy ? "等待本机连接确认…" : "连接本机助手"}</button>
      {local.pairUrl && <><p className="ai-help"><a href={local.pairUrl} target="_blank" rel="noreferrer">未看到窗口？点击打开本机确认页</a>，允许连接后返回此处，网站会自动更新。</p><button className="text-button" onClick={local.cancelPair}>取消本次连接</button></>}
      <p className="ai-help"><a href={`${LOCAL_ASSISTANT_ORIGIN}/`} target="_blank" rel="noreferrer">检查本机助手 / 打开本机版</a></p>
    </> : <>
      {!!local.status.accounts.length && <label className="ai-field"><span>选择本机保存的账号</span><select aria-label="选择本机保存的账号" value={local.accountId} onChange={event => void local.chooseAccount(event.target.value)} disabled={local.busy}>
        {local.status.accounts.map(account => <option key={account.id} value={account.id}>{account.email} · {account.plan || account.id.slice(0, 6)}</option>)}</select></label>}
      {local.account && <p className="ai-help">{local.account.connected ? local.account.sharing ? "已完成官方账号授权和套餐使用授权。" : "已登录，尚未授予套餐使用权限。" : "账号信息已保留，需要重新登录。"}</p>}
      {!!local.models.length && <label className="ai-field"><span>ChatGPT 模型</span><select aria-label="ChatGPT 模型" value={model} onChange={event => selectModel(event.target.value)}>
        {local.models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <div className="ai-actions"><button className="button primary" onClick={() => void local.login()} disabled={local.busy}><LogIn size={16} />{local.account ? "重新登录所选账号" : "Continue with ChatGPT"}</button>
        {local.account && <button className="text-button" onClick={() => void local.login(true)} disabled={local.busy}>添加其他账号</button>}
        <button className="text-button" onClick={() => void local.refresh()} disabled={local.busy}><RefreshCw size={15} />刷新账号状态</button></div>
      <div className="ai-actions">{local.account?.connected && <button className="text-button" onClick={() => void local.signOut()} disabled={local.busy}>退出所选账号</button>}
        <button className="text-button" onClick={() => void local.disconnect()} disabled={local.busy}><Unplug size={15} />断开网页连接</button></div>
    </>}
    {local.error && <p className="warning-box" role="alert">{local.error}</p>}
    {local.notice && <p className="ai-help" role="status">{local.notice}</p>}
    {local.status.login?.pending && <p className="ai-help" role="status">正在等待官方登录完成…</p>}
    {local.loginUrl && <p className="ai-help"><a href={local.loginUrl} target="_blank" rel="noreferrer">未看到官方窗口？点击打开 OpenAI 登录页</a></p>}
    <p className="ai-help">凭证由本机程序保存，Windows 使用当前用户的系统加密保护。网页只保存上次账号显示信息；刷新后需重新连接本机。首次回答完成前，模型列表不代表推理已验证。</p>
    <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">管理 ChatGPT 套餐用量与授权</a>
  </section>;
}
