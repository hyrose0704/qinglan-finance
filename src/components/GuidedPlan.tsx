import { useState } from "react";
import { BookOpen, CheckCircle2, CircleHelp, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { buildLearningPlan, EMPTY_PREFERENCES, LEARNING_SHOCKS, readPreferences } from "@/lib/allocation";
import { money, RISK_MIX, type Profile, type Risk, type calculate } from "@/lib/finance";
import { useLocalRecord } from "./useLocalRecord";

interface Props {
  profile: Profile;
  balances: ReturnType<typeof calculate>;
  privacy: boolean;
  edit: () => void;
  setRisk: (risk: Risk) => void;
  learn: (lesson: string) => void;
}

export function GuidedPlan({ profile, balances, privacy, edit, setRisk, learn }: Props) {
  const preferences = useLocalRecord("qinglan-planning-v1", EMPTY_PREFERENCES, readPreferences);
  const [shocks, setShocks] = useState(LEARNING_SHOCKS);
  const [checks, setChecks] = useState({ price: false, fees: false, time: false });
  const plan = buildLearningPlan(profile, balances, preferences.record, shocks);
  const pending = plan.missing.length > 0 || profile.expense + profile.monthlyDebt <= 0;
  const show = (value: number) => privacy ? "••••" : money(value);
  const categories = [
    { key: "cash", title: "待配置现金", color: "#386f5b", detail: "先保留流动性；选择存款、现金工具或债券前另核规则与风险。" },
    { key: "equity", title: "股票类资产", color: "#91aaa2", detail: "资产类别比较。已录入持仓仅为纳指C，不能代表充分分散。" },
    { key: "gold", title: "黄金", color: "#c5a46b", detail: "承担价格与价差风险；不代替应急金。" },
  ] as const;
  let status = "比较剩余资金的去向";
  if (plan.missing.length) status = "先补齐规划条件";
  else if (profile.expense + profile.monthlyDebt <= 0) status = "先核对必要支出";
  else if (balances.monthlyDeficit > 0) status = "先修复每月现金流";
  else if (balances.reserveGap > 0) status = "先补齐生活与目标预留";
  else if (balances.longTerm <= 0) status = "当前资金优先覆盖预留";

  return <div className="guided-plan">
    <section className="learning-hero">
      <div><span className="eyebrow">每个金额，都有理由</span><h2>把钱分好，也把原因弄懂。</h2>
        <p>先照顾生活与明确目标，再比较长期闲钱的风险。跟着计算走一遍，形成自己的判断。</p></div>
      <button className="button secondary" onClick={() => learn("reserve")}><BookOpen size={17} />先学资金分层</button>
    </section>

    <section className="panel planner-foundation">
      <div className="panel-heading"><h2>你的规划起点</h2><span className="badge gold">{profile.mode === "demo" ? "示例资金 · 可体验规则" : "按已录入资金测算"}</span></div>
      <div className="planner-input-summary">
        <div><span>已录入资产</span><strong>¥{show(balances.total)}</strong></div>
        <div><span>每月必要支出与还款</span><strong>¥{show(profile.expense + profile.monthlyDebt)}</strong></div>
        <div><span>可接受亏损金额</span><strong>¥{show(profile.maxLoss)}</strong></div>
        <button className="button secondary" onClick={edit}><SlidersHorizontal size={16} />核对资金档案</button>
      </div>
      {profile.mode === "demo" && <p className="planner-notice">这里仍是演示金额。生成与你有关的计算前，请先录入自己的资产、收支与用款目标。</p>}
      <div className="preference-grid">
        <label className="field"><span>扣除预留后，这笔钱何时可能使用？</span>
          <select value={preferences.record.horizon} onChange={e => preferences.save(readPreferences({ ...preferences.record, horizon: e.target.value }))}>
            <option value="unknown">请选择用款时间</option><option value="within3">3年以内</option>
            <option value="3to5">3—5年</option><option value="over5">5年以上</option>
          </select>
        </label>
        <label className="field"><span>收入是否稳定？</span>
          <select value={preferences.record.income} onChange={e => preferences.save(readPreferences({ ...preferences.record, income: e.target.value }))}>
            <option value="unknown">请选择收入情况</option><option value="stable">较稳定</option><option value="variable">波动较大或不确定</option>
          </select>
        </label>
        <label className="field"><span>对准备投资的产品了解多少？</span>
          <select value={preferences.record.experience} onChange={e => preferences.save(readPreferences({ ...preferences.record, experience: e.target.value }))}>
            <option value="unknown">请选择理解程度</option><option value="learning">正在学习，还不熟悉规则</option>
            <option value="familiar">了解风险、费用与申赎规则</option>
          </select>
        </label>
      </div>
      <div className="planner-risk-row"><span>选择用于比较的起始模板</span><div className="segmented">
        {(Object.keys(RISK_MIX) as Risk[]).map(risk => <button key={risk} aria-pressed={profile.risk === risk}
          className={profile.risk === risk ? "active" : ""} onClick={() => setRisk(risk)}>{RISK_MIX[risk].name}</button>)}
      </div></div>
      <p className="planner-help">偏好只保存在当前浏览器。此处为学习模型，不是正式风险评级；模板还会受期限、理解程度与损失假设约束。</p>
      {preferences.error && <p className="warning-box" role="status">{preferences.error}</p>}
    </section>

    <section className="panel">
      <div className="panel-heading"><h2>先安排生活，再安排投资</h2><button className="text-button" onClick={() => learn("cash")}>理解这笔账</button></div>
      <div className="funding-steps">
        <article><ShieldCheck size={23} /><div><h3>应急金</h3><strong>¥{show(balances.emergency)}</strong>
          <p>{profile.emergencyMonths}个月 × 必要支出与还款 ¥{show(profile.expense + profile.monthlyDebt)}。核对可用时间，避免被迫卖出。</p></div></article>
        <article><CheckCircle2 size={23} /><div><h3>近期用款与额外还款</h3><strong>¥{show(profile.nearTerm + profile.priorityDebt)}</strong>
          <p>明确用款 ¥{show(profile.nearTerm)}，额外还款预留 ¥{show(profile.priorityDebt)}。和应急金分别记录。</p></div></article>
        <article><SlidersHorizontal size={23} /><div><h3>剩余待规划资金</h3><strong>¥{show(balances.longTerm)}</strong>
          <p>包含现有黄金、基金和剩余现金。其中当前可新增投资现金为 ¥{show(balances.freeCash)}。</p></div></article>
      </div>
      <p className="planner-equation">max(0，已录入总资产 ¥{show(balances.total)} − 预留 ¥{show(balances.reserve)}) = ¥{show(balances.longTerm)}</p>
      <div className="planner-decision" role="status"><strong>{status}</strong>
        {plan.missing.length > 0 && <p>还缺：{plan.missing.join("、")}。资料补齐前仅保留已录入资金测算，不生成候选配置。</p>}
        {profile.expense + profile.monthlyDebt <= 0 && <p>必要支出为0，无法可靠估算应急金。请先核对是否漏填。</p>}
        {balances.monthlyDeficit > 0 && <p>每月确定支出超过收入 ¥{show(balances.monthlyDeficit)}，先减少缺口与保持流动性。</p>}
        {balances.reserveGap > 0 && <p>现金预留还差 ¥{show(balances.reserveGap)}。按当前月结余，
          {plan.monthsToReserve === null ? "暂无法估算补齐时间。" : `约需 ${plan.monthsToReserve} 个月补齐；假设收支和目标不变。`}</p>}
        {!plan.blocked && <p>预留和收支检查通过。下面展示带约束的配置比较，金额仍需结合全部家庭资产和实际产品核对。</p>}
      </div>
    </section>

    <div className="two-column">
      <section className="panel">
        <div className="panel-heading"><h2>剩余资金如何分配</h2><span className="badge">学习用候选金额</span></div>
        {pending ? <p className="planner-notice">先补齐上方规划条件并核对必要支出，再展示各类候选金额。现有持仓保持原样供你核对。</p> : <><div className="guided-mix" role="img" aria-label="待规划资金候选分布">
          {categories.map(item => <i key={item.key} style={{ background: item.color, width: `${balances.longTerm ? plan.target[item.key] / balances.longTerm * 100 : 0}%` }} />)}
        </div>
        <div className="candidate-list">{categories.map(item => <article key={item.key}>
          <div><h3><i style={{ background: item.color }} />{item.title}</h3><span>{balances.longTerm ? (plan.target[item.key] / balances.longTerm * 100).toFixed(1) : "0.0"}%</span></div>
          <strong>¥{show(plan.target[item.key])}</strong><p>{item.detail}</p>
          <small>当前扣除预留后 ¥{show(plan.current[item.key])} · 相比候选
            {plan.current[item.key] > plan.target[item.key] ? "多 " : "少 "}¥{show(Math.abs(plan.current[item.key] - plan.target[item.key]))}</small>
        </article>)}</div></>}
        <p className="planner-help">差额用于发现偏离，不是买卖指令。预留缺口存在时，现有持仓可能同时承担用款压力；把候选显示为现金不会自动卖出持仓。</p>
      </section>
      <section className="panel">
        <div className="panel-heading"><h2>为什么这样分</h2><button className="text-button" onClick={() => learn("diversify")}>学习分散投资</button></div>
        <ul className="planner-reasons">{plan.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        <details className="method-details"><summary>查看模型规则与局限</summary>
          <p>规则由本站为学习比较设置：3年内风险资产为0；3—5年股票类最多25%、黄金最多10%；收入波动大时同样收紧；仍在学习时股票类最多20%、黄金最多10%。多个条件同时成立时取较低值。</p>
          <p>再按你填写的亏损金额和下方假设跌幅同比缩小风险资产。剩余金额留在现金候选栏。比例不是监管标准，也未用历史收益优化。</p>
          <p>现金栏在本情景按0%变化计算；货币基金、债券和其他现金替代品并非都没有损失风险，选定产品后需另做压力测算。未计税费、通胀、汇率对冲、完整负债与产品持仓重合度。</p>
          <a href="https://www.investor.gov/introduction-investing/getting-started/asset-allocation" target="_blank" rel="noreferrer">阅读配置原则：期限、风险与分散</a>
        </details>
      </section>
    </div>

    <div className="two-column">
      <section className="panel">
        <div className="panel-heading"><h2>下跌时，金额能否承受</h2><button className="text-button" onClick={() => learn("risk")}>理解回撤</button></div>
        <label className="range-field"><span>假设股票类下跌<b>{shocks.equity}%</b></span>
          <input aria-label="规划假设股票跌幅" type="range" min="10" max="60" step="5" value={shocks.equity}
            onChange={e => setShocks({ ...shocks, equity: Number(e.target.value) })} /></label>
        <label className="range-field"><span>假设黄金下跌<b>{shocks.gold}%</b></span>
          <input aria-label="规划假设黄金跌幅" type="range" min="10" max="40" step="5" value={shocks.gold}
            onChange={e => setShocks({ ...shocks, gold: Number(e.target.value) })} /></label>
        <div className="planner-stress">
          <div><span>现有持仓情景损失</span><strong>−¥{show(plan.currentStress)}</strong></div>
          <div><span>候选配置情景损失</span><strong>{pending ? "待评估" : `−¥${show(plan.targetStress)}`}</strong></div>
        </div>
        <p className={plan.currentStress > profile.maxLoss ? "warning-box" : "planner-notice"}>
          {plan.currentStress > profile.maxLoss ? "现有持仓在此情景超过你填写的亏损承受金额，新增资金先保留现金，再检查集中度和实际用款。" : "现有持仓在此情景未超出你填写的金额；实际损失仍可能更大。"}</p>
        <p className="planner-help">调整跌幅会重新计算候选比例。压力情景不表示发生概率，也不构成最大亏损保证。</p>
      </section>
      <section className="panel">
        <div className="panel-heading"><h2>下个月的新钱怎么安排</h2><span className="badge">按当前目标缺口</span></div>
        <p className="monthly-total">月结余 <strong>¥{show(balances.surplus)}</strong></p>
        <dl className="monthly-breakdown">
          <div><dt>先补现金预留</dt><dd>¥{show(plan.monthly.reserve)}</dd></div>
          <div><dt>暂留现金 / 后续目标</dt><dd>¥{show(plan.monthly.cash)}</dd></div>
          <div><dt>股票类候选新增</dt><dd>¥{show(plan.monthly.equity)}</dd></div>
          <div><dt>黄金候选新增</dt><dd>¥{show(plan.monthly.gold)}</dd></div>
        </dl>
        <p className="planner-help">先补预留，再按候选目标的正缺口分配；新增风险受现有持仓的情景余量约束，黄金另受持仓成本预算限制。未分配资金保留现金。补齐后重新核对实际数据再算。</p>
        <button className="button secondary full" onClick={() => learn("review")}>学习执行与复盘</button>
      </section>
    </div>

    <section className="panel execution-checks"><div className="panel-heading"><h2>投入前，逐项核对</h2><CircleHelp size={18} /></div>
      <p>把候选金额落实到具体产品前，需要你确认这些规则。勾选仅用于本次核对。</p>
      {([
        ["price", "已核对实际报价、净值日期与已有全部持仓"],
        ["fees", "已阅读产品风险、总费用、申购限制与赎回规则"],
        ["time", "到账时间匹配用款，并确定下次复查的时间"],
      ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={checks[key]}
        onChange={e => setChecks({ ...checks, [key]: e.target.checked })} /><span>{label}</span></label>)}
      <p className="planner-help">完成 {Object.values(checks).filter(Boolean).length} / 3 项。页面只提供学习与计算，实际成交在你的原有平台确认。</p>
    </section>
  </div>;
}
