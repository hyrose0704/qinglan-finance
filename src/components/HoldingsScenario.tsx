import { useState } from "react";
import { BookOpen, ChartNoAxesCombined } from "lucide-react";
import { money, type Profile, type calculate } from "@/lib/finance";
import { HOLDINGS_SCENARIOS, holdingsScenario } from "@/lib/holdings-scenario";
import "../holdings-scenario.css";

interface Props {
  profile: Profile;
  balances: ReturnType<typeof calculate>;
  privacy: boolean;
  learn: (id: string) => void;
  edit: () => void;
}

function percent(value: number) {
  return `${value > 0 ? "+" : ""}${Number(value.toFixed(2))}%`;
}

function amount(value: number) {
  const rounded = Math.round(Math.abs(value) * 100) / 100;
  if (rounded === 0) return "¥0.00";
  return `${value < 0 ? "−" : "+"}¥${money(rounded, 2)}`;
}

export function HoldingsScenario({ profile, balances, privacy, learn, edit }: Props) {
  const [selected, setSelected] = useState(0);
  const scenario = HOLDINGS_SCENARIOS[selected];
  const result = holdingsScenario(profile, balances, scenario);
  const currencyImpact = result.fundReturn - scenario.equity;
  const rows = [
    { asset: "019442", rate: result.fundReturn, change: result.fundChange, missing: "缺基金净值" },
    { asset: "黄金", rate: scenario.gold, change: result.goldChange, missing: "缺黄金单价" },
    { asset: "人民币现金", rate: 0, change: 0, missing: "" },
  ];

  return <section className="panel holdings-scenario" aria-labelledby="holdings-scenario-title">
    <div className="panel-heading">
      <h2 id="holdings-scenario-title"><ChartNoAxesCombined size={20} />如果市场这样变，我的持仓会怎样？</h2>
      <span className="badge">{profile.mode === "demo" ? "示例持仓" : "已录入持仓"} · 假设情景</span>
    </div>
    <div className="holding-scenario-tabs" role="group" aria-label="选择持仓情景">
      {HOLDINGS_SCENARIOS.map((item, index) => <button type="button" key={item.title}
        aria-pressed={selected === index} onClick={() => setSelected(index)}>{item.title}</button>)}
    </div>
    <div aria-live="polite">
      <dl className="holding-scenario-inputs">
        <div><dt>美元计价股票回报</dt><dd>{percent(scenario.equity)}</dd></div>
        <div><dt>美元兑人民币变化</dt><dd>{percent(scenario.currency)}</dd></div>
        <div><dt>人民币金价变化</dt><dd>{percent(scenario.gold)}</dd></div>
      </dl>
      <p className="holding-scenario-analysis">假设基金完全跟随美元股票且不对冲汇率，折成人民币的回报为
        （1 {scenario.equity < 0 ? "−" : "+"} {Math.abs(scenario.equity)}%）×（1 {scenario.currency < 0 ? "−" : "+"} {Math.abs(scenario.currency)}%）− 1 = <b>{percent(result.fundReturn)}</b>。
        本例中汇率使回报{currencyImpact > 0 ? "提高" : "降低"}了{Number(Math.abs(currencyImpact).toFixed(2))}个百分点。</p>
      {privacy ? <p className="planner-help">金额隐私已开启，持仓测算结果已隐藏。</p>
        : result.empty ? <div className="holding-scenario-notice"><span>尚无可测算的持仓，录入现金、基金份额或黄金克数后即可查看金额变化。</span>
          <button className="text-button" type="button" onClick={edit}>录入资产</button></div>
        : <><table className="holding-scenario-table"><caption className="visually-hidden">假设情景下已录入持仓的人民币市值变化</caption>
          <thead><tr><th scope="col">资产</th><th scope="col">人民币涨跌</th><th scope="col">市值变化</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.asset}><th scope="row">{row.asset}</th><td>{percent(row.rate)}</td>
            <td>{row.change === null ? row.missing : amount(row.change)}</td></tr>)}</tbody>
          <tfoot><tr><th scope="row" colSpan={2}>已录入持仓合计变化</th><td>{result.totalChange === null ? "待补估值" : amount(result.totalChange)}</td></tr></tfoot>
        </table>
          {result.totalChange === null ? <div className="holding-scenario-notice"><span>已有份额或克数的资产缺少估值，补齐单价后可看合计。</span>
            <button className="text-button" type="button" onClick={edit}>补充估值</button></div>
            : result.fundChange !== null && result.goldChange !== null && result.fundChange !== 0 && result.goldChange !== 0 &&
              <p className="holding-scenario-analysis">{result.fundChange * result.goldChange < 0
                ? "两项市值变动方向相反，黄金与基金的变化在合计中相互抵消了一部分。"
                : result.fundChange < 0 ? "基金与黄金在这个情景中同时产生损失，两项跌幅都计入组合。" : "基金与黄金在这个情景中同时上涨，两项增值都计入组合。"}</p>}
        </>}
    </div>
    <div className="holding-scenario-foot"><p>以持仓页参考市值为起点，人民币现金保持不变，黄金直接用人民币金价。实际基金受权益仓位、现金、对冲、费用与跟踪差异影响。情景数值均为教学假设。</p>
      <button type="button" className="text-button" onClick={() => learn("portfolio-stress")}><BookOpen size={15} />学习组合压力测试</button></div>
  </section>;
}
