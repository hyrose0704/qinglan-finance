import { Coins, Clock3 } from "lucide-react";
import { domesticGoldChange, SGE_DELAYED_URL, SGE_DAILY_URL, type DomesticGold } from "@/lib/domestic-gold";
import { money } from "@/lib/finance";
import { signedChange } from "@/lib/morning-brief";

export function DomesticGoldCard({ snapshot }: { snapshot?: DomesticGold }) {
  const quote = snapshot?.quote, change = snapshot ? domesticGoldChange(snapshot) : null;
  const collected = snapshot?.collectedAt ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(snapshot.collectedAt)) : "尚未成功采集";
  return <section className="panel domestic-gold" aria-labelledby="domestic-gold-title">
    <div className="domestic-gold-main"><div className="domestic-gold-label"><Coins size={20} /><h2 id="domestic-gold-title">国内现货黄金</h2><span className="badge gold">Au99.99</span></div>
      <div className="domestic-gold-price"><strong>{quote ? money(quote.price, 2) : "—"}</strong><span>元/克</span>
        {change !== null && <b className={change > 0 ? "up" : change < 0 ? "down" : ""}>{signedChange(change)}<small>较上个交易日收盘</small></b>}</div>
      <p>上海黄金交易所 · {snapshot?.cached ? "上次有效报价" : quote?.kind === "close" ? "最近收盘价" : "延时报价"}
        {quote ? ` · 报价日 ${quote.date}` : " · 等待来源数据"}</p>
    </div>
    <div className="domestic-gold-detail">{quote && <dl><div><dt>开盘</dt><dd>{money(quote.open, 2)}</dd></div><div><dt>最高</dt><dd>{money(quote.high, 2)}</dd></div><div><dt>最低</dt><dd>{money(quote.low, 2)}</dd></div></dl>}
      <p><Clock3 size={14} />采集于 {collected}（北京）</p><p>来源未提供分钟级报价时刻；每15分钟尝试采集，非交易级实时价。</p>
      <a href={quote?.kind === "close" ? SGE_DAILY_URL : SGE_DELAYED_URL} target="_blank" rel="noreferrer">核对上金所原始行情</a>
    </div>
    <p className="domestic-gold-boundary">交易所现货参考价，含境内供需因素。金店零售价、银行积存金买卖价和实际到账价可能不同，持仓仍按你选择的估值方式计算。</p>
  </section>;
}
