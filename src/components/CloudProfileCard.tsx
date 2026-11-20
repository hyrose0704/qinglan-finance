import { useState } from "react";
import { Cloud, Database, History, LogIn, LogOut, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { money, NUMERIC_PROFILE_FIELDS, RISK_MIX, type NumericProfileField, type Profile } from "@/lib/finance";
import type { useProfileStore } from "./useProfileStore";
import "../profile-storage.css";

type Store = ReturnType<typeof useProfileStore>;
export function profileStatus(store: Store) {
  if (store.busy) return "正在保存或连接";
  if (store.unsaved) return "未保存更改";
  if (store.phase === "loading" || store.phase === "starting") return "正在读取档案";
  if (store.phase === "conflict") return "版本待选择";
  if (store.phase === "pending" || store.phase === "error") return "云端待同步";
  if (store.user && store.remote) return `云端第 ${store.remote.revision} 版`;
  if (store.user) return "云端尚无档案";
  return store.saved ? "仅浏览器保存" : "尚无个人档案";
}
const labels = ["现金与存款（元）", "月收入（元）", "月支出（元）", "每月还款（元）", "额外还款预留（元）", "近期用款（元）", "应急金（月）", "可承受亏损（元）", "黄金（克）", "黄金成本（元）", "手动金价（元/克）", "黄金成本上限（元）", "基金（份）", "基金成本（元）", "手动净值（元/份）"];
function timestamp(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short", hour12: false }).format(new Date(value));
}
function Compare({ profile, other, privacy }: { profile: Profile; other?: Profile; privacy: boolean }) {
  const amount = (value: number) => privacy ? "••••" : money(value, 4).replace(/\.?0+$/, "");
  const field = (p: Profile, key: NumericProfileField) => privacy ? "••••" : p.filledFields && !p.filledFields.includes(key) ? "未填写（按0）" : amount(p[key]);
  return <div className="profile-comparison"><table><thead><tr><th>已录入项目</th><th>{other ? "当前浏览器" : "准备保存"}</th>{other && <th>云端</th>}</tr></thead><tbody>
    {NUMERIC_PROFILE_FIELDS.map((key, i) => <tr key={key}><td>{labels[i]}</td><td>{field(profile, key)}</td>{other && <td>{field(other, key)}</td>}</tr>)}
    <tr><td>风险偏好</td><td>{RISK_MIX[profile.risk].name}</td>{other && <td>{RISK_MIX[other.risk].name}</td>}</tr>
    <tr><td>使用行情估值</td><td>{profile.useGoldQuote ? "黄金：是" : "黄金：否"} / {profile.useFundNav ? "基金：是" : "基金：否"}</td>{other && <td>{other.useGoldQuote ? "黄金：是" : "黄金：否"} / {other.useFundNav ? "基金：是" : "基金：否"}</td>}</tr>
  </tbody></table></div>;
}

export function CloudProfileCard({ store, privacy }: { store: Store; privacy: boolean }) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [signup, setSignup] = useState(false);
  const [url, setUrl] = useState(""), [key, setKey] = useState(""), [error, setError] = useState("");
  const [restore, setRestore] = useState<{ profile: Profile; source: string } | null>(null);
  const canSave = !!store.user && !store.busy && store.phase !== "loading" && store.phase !== "conflict";
  return <section className="panel cloud-profile" aria-labelledby="cloud-profile-heading">
    <div className="panel-heading"><h2 id="cloud-profile-heading"><Database size={20} />我的云端资金档案</h2><span className={`badge ${store.phase === "ready" && store.remote ? "green" : "gold"}`}>{profileStatus(store)}</span></div>
    <p className="cloud-intro">登录后，手机和电脑读取同一份资产。网站更新与重新发布不会重建或清空数据库。每个账号只能读取自己的云端档案。</p>
    {!store.configured ? <div className="cloud-unconfigured"><Cloud size={25} /><div><h3>云数据库尚未连接</h3><p>当前仍可保存到此浏览器、导出档案。云端配置完成后，再登录并迁移已有资料。</p></div></div>
      : !store.user ? <div className="cloud-login"><div><h3>{signup ? "建立你的档案账号" : "登录，找回自己的资产"}</h3><p>这是资金档案账号，与 ChatGPT、DeepSeek 的登录分开。密码交给数据库身份服务验证，网页不保存密码。</p></div>
        <form onSubmit={async event => { event.preventDefault(); await store.login(email.trim(), password, signup); setPassword(""); }}>
          <label className="cloud-field"><span>邮箱</span><input aria-label="资金档案邮箱" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} /></label>
          <label className="cloud-field"><span>密码</span><input aria-label="资金档案密码" type="password" autoComplete={signup ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} required minLength={signup ? 8 : 1} maxLength={128} /></label>
          <div className="cloud-actions"><button className="button primary" disabled={store.busy}><LogIn size={16} />{signup ? "注册档案账号" : "登录资金档案"}</button><button className="text-button" type="button" disabled={store.busy} onClick={() => { setSignup(!signup); setPassword(""); }}>{signup ? "已有账号，去登录" : "首次使用，注册账号"}</button></div>
          <small>登录状态保留在此浏览器，共用设备请及时退出。注册可能需要邮件确认。</small>
        </form></div> : <>
        <div className="cloud-account"><span className="cloud-account-icon"><ShieldCheck size={23} /></span><div><h3>{store.user.email}</h3><p>{store.remote ? `云端更新于 ${timestamp(store.remote.updatedAt)}（北京时间）` : store.phase === "ready" ? "当前账号还没有云端资金档案。" : "尚未确认云端档案，请核对连接状态。"}</p></div><button className="text-button" onClick={() => void store.logout()} disabled={store.busy}><LogOut size={15} />退出账号</button></div>
        {store.phase === "loading" && <p role="status">正在读取该账号的资产，请稍候…</p>}
        {store.phase === "conflict" && <div className="cloud-conflict"><h3>两处都有修改，先比较再保存</h3><p>本次输入已保留。使用云端版本会保留本机历史；保存当前内容会新建一版，仍会检查是否又有设备更新。</p>
          {store.profile.mode === "personal" && <Compare profile={store.profile} other={store.remote?.profile} privacy={privacy} />}
          {!store.canResolveConflict && <p>请重新读取云端，获取可供比较的最新版本。</p>}
          <div className="cloud-actions"><button className="button secondary" disabled={store.busy || !store.canResolveConflict} onClick={store.useRemote}>使用云端版本</button><button className="button primary" disabled={store.busy || !store.canResolveConflict || store.profile.mode !== "personal"} onClick={() => void store.keepCurrent()}>已核对，保存当前内容</button></div></div>}
        <div className="cloud-actions"><button className="button secondary" disabled={store.busy || store.phase === "loading"} onClick={() => void store.refresh()}><RefreshCw size={16} />重新读取云端</button>
          <button className="button primary" disabled={!canSave || store.profile.mode !== "personal"} onClick={() => void store.save(store.profile)}><Save size={16} />同步当前档案</button>
          <button className="button secondary" disabled={store.busy || store.phase === "loading"} onClick={() => void store.readHistory()}><History size={16} />云端历史版本</button></div>
        {store.guest && !store.remote && store.phase === "ready" && <div className="cloud-migrate"><h3>这台浏览器已有一份个人档案</h3><p>它暂时独立于云端。核对内容后，可保存到上方显示的账号；不会自动上传示例或覆盖其他账号。</p><button className="button secondary" disabled={!canSave} onClick={() => setRestore({ profile: store.guest!, source: "此浏览器原有档案" })}>查看并迁移原有档案</button></div>}
        {!!store.history.length && <div className="cloud-history"><h3>云端最近 {store.history.length} 次保存</h3><p>选择旧版后先核对，再保存为新版本。最新档案不会直接回退或删除。</p>{store.history.map(row => <div key={row.revision}><span>第 {row.revision} 版<small>{timestamp(row.updatedAt)}</small></span><button className="text-button" disabled={!canSave} onClick={() => setRestore({ profile: row.profile, source: `云端第 ${row.revision} 版` })}>查看与恢复</button></div>)}</div>}
      </>}
    {store.authNotice && <p className="warning-box" role="status">{store.authNotice}</p>}
    {store.message && <p className="warning-box" role="status">{store.message}</p>}
    {!!store.localCopies.length && <details className="cloud-local-history"><summary>此浏览器的历史副本（最近10次）</summary><p>浏览器历史不能替代云端；清理网站数据也会清除这些副本。</p>{store.localCopies.map((copy, index) => <div key={`${copy.copiedAt}-${index}`}><span>{timestamp(copy.copiedAt)}<small>{copy.pending ? "当时待同步" : "浏览器副本"}</small></span><button className="text-button" disabled={store.busy} onClick={() => setRestore({ profile: copy.profile, source: `浏览器副本 ${timestamp(copy.copiedAt)}` })}>查看与恢复</button></div>)}</details>}
    {restore && <div className="cloud-restore"><h3>核对要恢复的内容</h3><p>来源：{restore.source}。{store.user ? `将保存到 ${store.user.email}，并在云端新建版本。` : "将保存在此浏览器，尚未登录云端。"}</p><Compare profile={restore.profile} privacy={privacy} /><div className="cloud-actions"><button className="button primary" disabled={store.busy || (store.user ? !canSave : false)} onClick={async () => { if (await store.save(restore.profile)) setRestore(null); }}>确认恢复并保存</button><button className="button secondary" onClick={() => setRestore(null)} disabled={store.busy}>取消恢复</button></div></div>}
    {!store.configured && <details className="cloud-admin"><summary>管理员：连接已有 Supabase 项目</summary><p>只填写项目地址和 publishable / anon 公开 Key。数据库必须先完成建表及账号隔离配置。</p><form onSubmit={event => { event.preventDefault(); try { store.configure({ url, publishableKey: key }); } catch (value) { setError(value instanceof Error ? value.message : "配置未保存。"); } }}>
      <label className="cloud-field"><span>项目地址</span><input aria-label="Supabase 项目地址" type="url" placeholder="https://项目编号.supabase.co" value={url} onChange={event => setUrl(event.target.value)} required /></label>
      <label className="cloud-field"><span>公开连接 Key</span><input aria-label="Supabase 公开连接 Key" value={key} onChange={event => setKey(event.target.value)} placeholder="sb_publishable_… 或 anon Key" required /></label>
      <button className="button secondary">保存连接并重新打开</button>{error && <p role="alert" className="warning-box">{error}</p>}</form></details>}
    <div className="cloud-boundary"><ShieldCheck size={16} /><p>云端保存资产与收支、估值选项和风险偏好。AI Key、AI 授权凭证、对话、学习进度不随资产上传。云端保留最近20个版本；重要记录仍建议定期导出。</p></div>
  </section>;
}
