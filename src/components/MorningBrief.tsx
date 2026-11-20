import { useEffect, useRef, useState } from "react";
import { Newspaper, RefreshCw, ChevronDown, Clock3 } from "lucide-react";
import { BRIEF_SOURCES, morningWindow, readBriefArchive, signedChange, type BriefArchive } from "@/lib/morning-brief";
import { money } from "@/lib/finance";
import "../morning.css";

function clock(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
export function MorningBrief({ expandedByDefault = false }: { expandedByDefault?: boolean }) {
  const [archive, setArchive] = useState<BriefArchive | null>(null), [date, setDate] = useState("");
  const [expanded, setExpanded] = useState(expandedByDefault), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const inFlight = useRef(false);
  const edition = archive?.editions.find(row => row.date === date) || archive?.editions[0];
  async function refresh() {
    if (inFlight.current) return; inFlight.current = true; setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}brief.json?t=${Math.floor(Date.now() / 60000)}`, { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw Error();
      const next = readBriefArchive(await response.json(), Date.now()); if (!next) throw Error();
      setArchive(next); setError("");
    } catch { setError("晨报暂时读取失败，已读内容保留。请稍后重试。"); }
    finally { inFlight.current = false; setLoading(false); }
  }
  useEffect(() => { void refresh(); const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 300000); return () => clearInterval(timer); }, []);
  const stale = edition && edition.date < morningWindow(Date.now()).date;
  return <section className="panel morning-brief" aria-labelledby="morning-title">
    <div className="morning-heading"><div><span className="morning-eyebrow"><Clock3 size={14} />每天 09:00 · 北京时间</span><h2 id="morning-title"><Newspaper size={23} />市场晨报<span>{edition?.date || "等待首期"}</span></h2></div>
      <div className="morning-controls">{!!archive?.editions.length && <select aria-label="选择晨报日期" value={edition?.date} onChange={event => setDate(event.target.value)}>{archive.editions.map(row => <option key={row.date} value={row.date}>{row.date}</option>)}</select>}
        <button className="text-button" disabled={loading} onClick={() => void refresh()}><RefreshCw size={15} />{loading ? "读取中" : "读取晨报"}</button></div></div>
    <p className="morning-intro">先看昨天发生了什么，再看报道线索与可能的传导机制。</p>
    {error && <p className="warning-box" role="status">{error}</p>}
    {stale && <p className="warning-box" role="status">{date ? "正在查看历史晨报。" : "本期晨报尚未更新，显示上次已发布内容。"}报告日期与数据日期均保留。</p>}
    {!edition ? <p className="morning-empty">{loading ? "正在读取已发布晨报…" : "首期晨报等待发布。每天早上9点计划更新，定时任务可能延迟。"}</p> : <>
      <p className="morning-overview">{edition.overview}</p>
      <div className="morning-moves">{edition.movements.map(move => <article key={move.id}><h3>{move.name}</h3><strong>{move.value === null ? "—" : money(move.value, 2)}<small>{move.unit}</small></strong>
        <p className={move.change === null ? "" : move.change > 0 ? "up" : move.change < 0 ? "down" : ""}>{move.change === null ? "日涨跌暂缺" : signedChange(move.change)}</p><a href={move.url} target="_blank" rel="noreferrer">{move.date || edition.reviewDate} · {move.value === null ? "未取得该日收盘" : "收盘"}</a>
        {move.low !== undefined && move.high !== undefined && <small className="morning-range">区间 {money(move.low, 2)}–{money(move.high, 2)}</small>}{move.collectedAt && <small className="morning-range">采集 {clock(move.collectedAt)}</small>}</article>)}</div>
      <div className="morning-bottom"><p>交易日复盘：{edition.reviewDate} · 新闻截止 {clock(edition.cutoff)}<br />本期整理于 {clock(edition.generatedAt)}（北京） · {edition.gaps.length ? "部分证据待补齐" : "已发布"}</p>
        <button className="button secondary" aria-expanded={expanded} aria-controls="morning-details" onClick={() => setExpanded(!expanded)}>{expanded ? "收起新闻与分析" : "展开新闻与分析"}<ChevronDown size={16} className={expanded ? "morning-chevron open" : "morning-chevron"} /></button></div>
      {expanded && <div id="morning-details" className="morning-details"><div className="morning-news"><h3>哪些消息值得核对</h3><p className="morning-help">按来源发布时间区分昨日与隔夜。中文导读根据RSS标题、摘要整理；英文标题保留原文入口。</p>
        {!edition.news.length && <p className="morning-help">本期未取得时段内可核对的相关新闻，不作具体事件归因。</p>}
        {edition.news.map(item => <article key={item.url}><div className="morning-news-meta"><span>{item.period === "overnight" ? "隔夜消息" : "前一日消息"}</span><span>{BRIEF_SOURCES.find(source => source.id === item.sourceId)?.name} · {clock(item.publishedAt)}</span></div><p>{item.note}</p><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a></article>)}</div>
        <div className="morning-analysis"><h3>怎样理解这些变化</h3><span className="badge">规则分析 · 推断与机制</span>{edition.analysis.map(item => <article key={item.title}><h4>{item.title}</h4><p>{item.text}</p>{!!item.references.length && <div className="morning-refs">{item.references.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">核对报道{index + 1}</a>)}</div>}</article>)}
          <div className="morning-learning"><h4>用到自己的资金上</h4><p>先核对应急金和近期用款，再看已有黄金、基金在假设下跌中的金额损失。晨报用于理解市场，不能据此推定今天应追涨、抄底或改变长期资金用途。</p></div></div>
        <details className="morning-evidence"><summary>来源、数据缺口与时间口径</summary><ul>{edition.sources.map(source => <li key={source.id}>{BRIEF_SOURCES.find(row => row.id === source.id)?.name}：{source.status === "fetched" ? `已采集，时段内相关标题 ${source.count} 条` : "未成功采集"}{source.checkedAt ? ` · ${clock(source.checkedAt)}（北京）` : ""}</li>)}{edition.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>
          <p>国内交易日包含上个工作日晚间交易；海外日线使用供应商交易日口径，美股收盘通常落在北京时间次日。未把今日盘中数据当昨日收盘，休市或缺失不当作0。新闻按发布时间筛选，覆盖有限；报道线索与价格同向不能单独证明因果。</p></details>
      </div>}
    </>}
    <p className="morning-footnote">每天09:00计划发布，GitHub Actions可能延迟；“读取”仅获取已发布内容。无需付费AI API，不自动消耗你的模型额度。</p>
  </section>;
}
