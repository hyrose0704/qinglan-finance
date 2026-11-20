import { useEffect, useRef, useState } from "react";
import { Newspaper, RefreshCw, Clock3 } from "lucide-react";
import { BRIEF_SOURCES, morningWindow, readBriefArchive, signedChange, type BriefArchive, type BriefMovement } from "@/lib/morning-brief";
import { interpretMorningEdition } from "@/lib/brief-interpretation";
import { money, type Profile } from "@/lib/finance";
import { BriefHoldingsImpact } from "./BriefHoldingsImpact";
import "../morning.css";

function clock(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function MarketMove({ move, reviewDate }: { move?: BriefMovement; reviewDate: string }) {
  if (!move) return <article className="brief-quote"><h3>万家纳指100 C · 019442</h3>
    <strong>未收录</strong><p>这期存档没有基金单位净值。</p></article>;
  const isFund = move.id === "fund";
  const decimals = isFund ? 4 : 2;
  const delta = move.value !== null && move.previousValue !== undefined ? move.value - move.previousValue : null;
  const signedDelta = delta === null ? null : new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals, signDisplay: "exceptZero",
  }).format(delta);
  return <article className="brief-quote">
    <h3>{isFund ? "万家纳指100 C · 019442" : move.name}</h3>
    {move.value === null ? <><strong className="brief-missing">{isFund ? "净值待核实" : "收盘数据暂缺"}</strong>
      {move.latestAvailable ? <p>{`最近可核验的是 ${move.latestAvailable.date} 的${isFund ? "净值" : "收盘"} ${money(move.latestAvailable.value, decimals)} ${move.unit}。`}</p> : !move.comparisonNote && <p>{`尚未取得 ${reviewDate} 的${isFund ? "单位净值" : "收盘价"}。`}</p>}</> :
      <><strong>{money(move.value, decimals)} <small>{move.unit}</small></strong>
        <p className="brief-quote-change">{signedDelta !== null && <span>{signedDelta} {move.unit}</span>}
          {move.change !== null ? <b>{signedChange(move.change)}</b> : delta === null && "日涨跌待核实"}</p></>}
    {move.comparisonNote && <p>{move.comparisonNote}</p>}
    {move.supplementedAt && <p className="brief-supplement">后续补录于 {clock(move.supplementedAt)}（北京）</p>}
    {move.low !== undefined && move.high !== undefined && <small>日内区间 {money(move.low, decimals)}–{money(move.high, decimals)} {move.unit}</small>}
    <a href={move.url} target="_blank" rel="noreferrer">{move.source} ↗</a>
    <small>{move.previousDate ? `比较 ${move.previousDate} 至 ${reviewDate}` : `复盘日期 ${reviewDate}`}{move.collectedAt && !move.supplementedAt && ` · 采集 ${clock(move.collectedAt)}`}</small>
  </article>;
}

interface Props {
  profile: Profile;
  privacy: boolean;
  loadingProfile: boolean;
  editProfile: () => void;
  expandedByDefault?: boolean;
}

export function MorningBrief({ profile, privacy, loadingProfile, editProfile, expandedByDefault = false }: Props) {
  const [archive, setArchive] = useState<BriefArchive | null>(null), [date, setDate] = useState("");
  const [expanded, setExpanded] = useState(expandedByDefault), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const inFlight = useRef(false);
  const edition = archive?.editions.find(row => row.date === date) || archive?.editions[0];
  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}brief.json?t=${Math.floor(Date.now() / 60000)}`, { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw Error();
      const next = readBriefArchive(await response.json(), Date.now());
      if (!next?.editions.length) throw Error();
      setArchive(next); setError("");
      setDate(selected => next.editions.some(row => row.date === selected) ? selected : "");
    } catch { setError("晨报暂时读取失败，请稍后重试。"); }
    finally { inFlight.current = false; setLoading(false); }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 300000);
    return () => clearInterval(timer);
  }, []);
  const stale = edition && edition.date < morningWindow(Date.now()).date;
  return <section id="morning-brief" className="panel morning-brief" aria-labelledby="morning-title">
    <div className="morning-heading"><div><span className="morning-eyebrow"><Clock3 size={14} />北京时间 09:00</span>
      <h2 id="morning-title"><Newspaper size={23} />市场晨报<span>{edition?.date || "等待发布"}</span></h2></div>
      <div className="morning-controls">{!!archive?.editions.length && <select aria-label="选择晨报日期" value={edition?.date} onChange={event => setDate(event.target.value)}>{archive.editions.map(row => <option key={row.date} value={row.date}>{row.date}</option>)}</select>}
        <button type="button" className="text-button" disabled={loading} onClick={() => void refresh()}><RefreshCw size={15} />{loading ? "读取中" : "读取晨报"}</button></div></div>
    {error && <p className="warning-box" role="status">{error}</p>}
    {stale && <p className="warning-box" role="status">{edition?.date !== archive?.editions[0]?.date ? "正在查看历史晨报，下面使用当前档案中的持仓数量回算。" : "本期尚未发布，当前显示最近一期晨报。"}</p>}
    {!edition ? <p className="morning-empty">{loading ? "正在读取已发布晨报…" : "正在等待可用晨报。"}</p> : <>
      <p className="brief-dateline">复盘 <strong>{edition.reviewDate}</strong> · 新闻截至 {clock(edition.cutoff)}（北京）</p>
      <div className="brief-primary-quotes" aria-label="黄金、纳指与基金的市场变化">
        {["domestic", "nasdaq", "fund"].map(id => <MarketMove key={id} move={edition.movements.find(row => row.id === id)} reviewDate={edition.reviewDate} />)}
      </div>
      <BriefHoldingsImpact profile={profile} edition={edition} privacy={privacy} loadingProfile={loadingProfile} editProfile={editProfile} />
      <h3 className="brief-analysis-title">可能的原因与接下来的关注点</h3>
      <div className="brief-readings">{interpretMorningEdition(edition).map(item => <article key={item.asset}>
        <h4>{item.title}</h4>
        <p>{item.possibleReason}</p>
        <div className="brief-watch"><strong>接下来关注</strong><p>{item.watch}</p></div>
        <details><summary>核对证据与其他解释</summary><p>{item.observation}</p><p>{item.counterEvidence}</p>
          <div className="brief-source-links">{item.sources.map(source => <a href={source.url} key={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}</div>
        </details>
        <div className="brief-source-links">{item.asset === "gold"
          ? <a href="#learn/gold">学一课：如何理解黄金在组合中的作用</a>
          : <a href="#learn/qdii">学一课：为什么我的基金和纳指涨跌不同</a>}</div>
      </article>)}</div>
      <div className="brief-source-bar">
        <span>本期初刊 {clock(edition.generatedAt)}（北京）{edition.updatedAt && edition.updatedAt !== edition.generatedAt && ` · 更新 ${clock(edition.updatedAt)}`}</span>
        <button type="button" className="button secondary" aria-expanded={expanded} aria-controls="morning-details" onClick={() => setExpanded(!expanded)}>{expanded ? "收起新闻与数据来源" : "展开新闻与数据来源"}</button>
      </div>
      {expanded && <div id="morning-details" className="morning-details">
        <div className="morning-news"><h3>本期新闻</h3>
          {!edition.news.length && <p className="morning-help">截至本期新闻截止时间，未取得可核对的相关报道。</p>}
          {edition.news.map(item => <article key={item.url}><div className="morning-news-meta"><span>{item.period === "overnight" ? "隔夜" : "前一日"}</span><span>{BRIEF_SOURCES.find(source => source.id === item.sourceId)?.name} · {clock(item.publishedAt)}（北京）</span></div>
            <p>{item.note}</p><a href={item.url} target="_blank" rel="noreferrer">{item.title} ↗</a></article>)}</div>
        <div className="brief-global"><h3>国际市场对照</h3>
          {edition.movements.filter(move => move.id === "gold" || move.id === "dxy").map(move => <MarketMove key={move.id} move={move} reviewDate={edition.reviewDate} />)}
        </div>
        <details className="morning-evidence"><summary>数据缺口与时间口径</summary><ul>{edition.sources.map(source => <li key={source.id}>{BRIEF_SOURCES.find(row => row.id === source.id)?.name} · {source.status === "fetched" ? `时段内相关标题 ${source.count} 条` : "采集未成功"}{source.checkedAt ? ` · 采集 ${clock(source.checkedAt)}` : ""}</li>)}{edition.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>
          <p>国内黄金采用上金所交易日。美股按美国交易日记录，收盘通常在北京时间次日。基金按人民币单位净值所属日对齐。价格可在来源更新后补齐，采集时间见各行情卡。新闻窗口固定截止当期 09:00。</p></details>
      </div>}
    </>}
    <p className="morning-footnote">晨报每日 09:00 计划发布，实际时间取决于采集与部署。持仓金额在你的浏览器内计算。</p>
  </section>;
}
