import { useEffect, useRef, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { POLICY_SOURCES, readPolicySnapshot, type PolicySnapshot } from "@/lib/policy";

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "尚未成功采集";
}

export function PolicyUpdates() {
  const [snapshot, setSnapshot] = useState<PolicySnapshot | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const inFlight = useRef(false);
  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}policy.json?t=${Math.floor(Date.now() / 60000)}`,
        { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw Error();
      const parsed = readPolicySnapshot(await response.json(), Date.now());
      if (!parsed) throw Error();
      setSnapshot(parsed);
      setError("");
    } catch { setError("官方发布快照暂时读取失败，已有内容保留并标注时间。"); }
    finally { inFlight.current = false; setLoading(false); }
  }
  useEffect(() => { void refresh(); const timer = setInterval(() => {
    if (document.visibilityState === "visible") void refresh();
  }, 300000); return () => clearInterval(timer); }, []);
  return <section className="panel policy-updates">
    <div className="panel-heading"><h2><FileText size={20} />核对原始政策发布</h2>
      <button className="button secondary" disabled={loading} onClick={() => void refresh()}><RefreshCw size={15} />{loading ? "读取中" : "读取最新快照"}</button></div>
    <p className="policy-intro">每个来源保留一条最新可用标题与原文链接。发布日期与采集时间分别展示，帮助核对依据；不自动推断行情因果。</p>
    {error && <p className="warning-box" role="status">{error}</p>}
    <div className="policy-grid">{POLICY_SOURCES.map(spec => {
      const source = snapshot?.sources.find(row => row.id === spec.id), item = source?.item;
      return <article key={spec.id}><div className="policy-source-heading"><h3>{spec.name}</h3>
        <span className="badge">{!item ? "暂缺" : source?.status === "cached" || error ? "上次有效内容" : "官方RSS快照"}</span></div>
        {item ? <><a className="policy-title" href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
          <p className="policy-date">发布：{date(item.publishedAt)}（北京时间）</p></> : <p className="policy-empty">{loading ? "正在读取已采集的发布信息。" : "暂时没有可核对的发布内容，可前往来源网站查看。"}</p>}
        <p className="policy-context">{spec.context}</p><small>成功采集：{date(source?.checkedAt || null)}</small>
        <a className="policy-home" href={spec.homeUrl} target="_blank" rel="noreferrer">查看官方发布目录</a>
      </article>;
    })}</div>
    <p className="planner-help">原始标题为英文。定时采集随 GitHub Actions 发布，调度可能延迟；点“读取”只更新网站现有快照，不会触发上游重新发布。</p>
  </section>;
}
