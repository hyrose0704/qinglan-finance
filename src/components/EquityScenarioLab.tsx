import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { compareEquityScenarios, EQUITY_CASE } from "@/lib/equity-scenarios";
import "../equity-scenario.css";

const settings = EQUITY_CASE;

function percentDifference(value: number | null) {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function EquityScenarioLab() {
  const [margin, setMargin] = useState<number>(settings.margin.initial);
  const [multiple, setMultiple] = useState<number>(settings.multiple.initial);
  const { downside, base, upside, requiredEps, requiredMargin, earningsBridge } = compareEquityScenarios(margin, multiple);
  const rows = [
    { title: "不利", result: downside },
    { title: "基准", result: base },
    { title: "有利", result: upside },
  ];
  const marginGap = margin - requiredMargin;

  return <section className="panel equity-scenario" id="equity-scenario-lab" aria-labelledby="equity-scenario-title">
    <div className="panel-heading"><h2 id="equity-scenario-title"><SlidersHorizontal size={20} />{settings.referencePrice} 元的股价需要多少盈利？</h2></div>
    <p className="equity-premise">假设一家虚构的上市公司未来一年收入为 {settings.revenue} 亿元，加权平均稀释股数为 {settings.dilutedShares} 亿股。所有情景都与同一个假设参考价 <strong>{settings.referencePrice} 元/股</strong> 比较。试着只动一个滑块，观察盈利或估值倍数如何影响结果。</p>
    <div className="equity-controls">
      <label className="range-field"><span>基准净利率<b>{margin}%</b></span>
        <input type="range" min={settings.margin.min} max={settings.margin.max} step="1" value={margin}
          aria-label="基准净利率" aria-valuetext={`${margin}%`} onChange={event => setMargin(Number(event.target.value))} />
      </label>
      <label className="range-field"><span>基准市盈率<b>{multiple} 倍</b></span>
        <input type="range" min={settings.multiple.min} max={settings.multiple.max} step="1" value={multiple}
          aria-label="基准市盈率" aria-valuetext={`${multiple} 倍`} onChange={event => setMultiple(Number(event.target.value))} />
      </label>
    </div>
    <div className="equity-breakpoint" aria-live="polite" aria-atomic="true">
      <h3>支撑 {settings.referencePrice} 元所需的净利率 <strong>{requiredMargin.toFixed(2)}%</strong></h3>
      <p>按 {multiple} 倍市盈率反推，每股收益需达到 {settings.referencePrice} ÷ {multiple} ≈ {requiredEps.toFixed(2)} 元。
        {Math.abs(marginGap) < 0.00001 ? "当前基准净利率恰好达到这个门槛。" :
          `当前基准净利率比这个门槛${marginGap > 0 ? "高" : "低"} ${Math.abs(marginGap).toFixed(2)} 个百分点。`}</p>
    </div>
    <table className="equity-case-table">
      <caption>三种未来一年盈利假设下的每股估值</caption>
      <thead><tr><th scope="col">情景</th><th scope="col">净利率<br />每股收益</th><th scope="col">市盈率<br />假设</th><th scope="col">每股估值<br />较参考价</th></tr></thead>
      <tbody>{rows.map(({ title, result }) => <tr key={title} className={title === "基准" ? "equity-base" : undefined}>
        <th scope="row">{title}</th><td>{result.margin}%<small>{result.eps.toFixed(2)} 元</small></td><td>{result.multiple} 倍</td>
        <td>{result.price === null ? "不适用" : `${result.price.toFixed(2)} 元`}<small>{percentDifference(result.differencePct)}</small></td>
      </tr>)}</tbody>
    </table>
    <p className="equity-equation">每股收益（EPS）= 收入 × 归属普通股股东的净利率 ÷ 稀释股数。以正的 EPS 乘以对应市盈率，得到每股估值。EPS 为零或负数时，该方法不适用。</p>
    <div className="equity-reasoning">
      <section><h3>有利情景的差额从哪里来？</h3>
        {earningsBridge ? <p>先让净利率提高 {settings.margin.spread} 个百分点，按 {base.multiple} 倍计，每股估值增加 {earningsBridge.marginEffect.toFixed(2)} 元。
          再按改善后的 EPS 将市盈率上调 {settings.multiple.spread} 倍，每股再增加 {earningsBridge.multipleEffect.toFixed(2)} 元。第二部分取决于市场愿意为同样的盈利支付更高倍数。</p> :
          <p>当前基准情景尚未盈利，无法按正市盈率拆出估值差额。先检查产品能否覆盖固定成本，再尝试把净利率调至正值。</p>}
      </section>
      <section><h3>下份财报怎样检验这些假设？</h3>
        <p>不利情景假设产品降价，净利率比基准少 {settings.margin.spread} 个百分点，市盈率也少 {settings.multiple.spread} 倍。先用财报中的售价、毛利率检验降价，再与同业在同一盈利期间的倍数比较。若利润改善来自一次性收益，或收入、股数偏离假设，就重算每股收益及所需净利率。</p>
      </section>
    </div>
    <p className="equity-note">表中差额衡量假设估值与参考价之间的距离。实验未设发生概率，未计股息和交易费用。</p>
  </section>;
}
