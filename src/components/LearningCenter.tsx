import { useState } from "react";
import { BookOpen, CheckCircle2, FlaskConical, GraduationCap } from "lucide-react";
import { compoundScenario, qdiiScenario, recoveryReturn } from "@/lib/allocation";
import { LESSONS, readLearningProgress } from "@/lib/curriculum";
import { money, type Profile, type calculate } from "@/lib/finance";
import { useLocalRecord } from "./useLocalRecord";
import { KnowledgeSearch } from "./KnowledgeSearch";

interface Props {
  profile: Profile;
  balances: ReturnType<typeof calculate>;
  privacy: boolean;
  topic: string;
  selectTopic: (topic: string) => void;
  plan: () => void;
}

function LearningLab() {
  const [tab, setTab] = useState<"fees" | "qdii" | "loss">("fees");
  const [principal, setPrincipal] = useState(10000), [monthly, setMonthly] = useState(500);
  const [years, setYears] = useState(10), [rate, setRate] = useState(4), [fee, setFee] = useState(1);
  const [asset, setAsset] = useState(10), [currency, setCurrency] = useState(-5), [loss, setLoss] = useState(20);
  const noFee = compoundScenario(principal, monthly, rate, 0, years);
  const withFee = compoundScenario(principal, monthly, rate, fee, years);
  const currencyResult = qdiiScenario(asset, currency);
  const range = (label: string, value: number, min: number, max: number, step: number, change: (n: number) => void, unit = "%") =>
    <label className="range-field"><span>{label}<b>{money(value, step < 1 ? 1 : 0)}{unit}</b></span>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => change(Number(e.target.value))} /></label>;

  return <section className="panel learning-lab">
    <div className="panel-heading"><h2><FlaskConical size={20} />动手算，比记结论更清楚</h2><span className="badge">纯假设实验</span></div>
    <div className="segmented lab-tabs" role="group" aria-label="选择计算实验">
      <button className={tab === "fees" ? "active" : ""} aria-pressed={tab === "fees"} onClick={() => setTab("fees")}>复利与费用</button>
      <button className={tab === "qdii" ? "active" : ""} aria-pressed={tab === "qdii"} onClick={() => setTab("qdii")}>QDII与汇率</button>
      <button className={tab === "loss" ? "active" : ""} aria-pressed={tab === "loss"} onClick={() => setTab("loss")}>亏损与回本</button>
    </div>
    {tab === "fees" && <div className="lab-content"><div>
      {range("实验初始金额", principal, 0, 100000, 1000, setPrincipal, "元")}
      {range("实验每月月底投入", monthly, 0, 5000, 100, setMonthly, "元")}
      {range("实验持有年数", years, 1, 30, 1, setYears, "年")}
      {range("假设年收益率", rate, -20, 20, 1, setRate)}
      {range("假设年度持续费用", fee, 0, 3, 0.1, setFee)}
    </div><div className="lab-results" aria-live="polite"><div><span>累计投入本金</span><strong>¥{money(withFee.contributed)}</strong></div>
      <div><span>无持续费用的假设终值</span><strong>¥{money(noFee.value)}</strong></div>
      <div><span>含持续费用的假设终值</span><strong>¥{money(withFee.value)}</strong></div>
      <p>费用造成的假设差额 <b>¥{money(noFee.value - withFee.value)}</b>。</p>
      <p>按恒定年收益、年末等效费用换算月收益，月底投入。不含申赎费、税费、通胀和收益顺序变化。可以把收益调成0或负值，观察本金也会减少。</p>
    </div></div>}
    {tab === "qdii" && <div className="lab-content"><div>
      {range("假设海外资产涨跌", asset, -50, 50, 1, setAsset)}
      {range("假设外币兑人民币涨跌", currency, -20, 20, 1, setCurrency)}
      <p className="planner-help">外币兑人民币下降表示同样的外币换得更少人民币。此处假设没有汇率对冲。</p>
    </div><div className="lab-results" aria-live="polite"><div><span>人民币口径假设收益</span><strong>{currencyResult >= 0 ? "+" : ""}{currencyResult.toFixed(2)}%</strong></div>
      <p>(1 {asset >= 0 ? "+" : "−"} {Math.abs(asset)}%) × (1 {currency >= 0 ? "+" : "−"} {Math.abs(currency)}%) − 1</p>
      <p>没有计算基金费用、跟踪差异、对冲和估值时差。这个结果不是019442当日估值或实际收益。</p>
    </div></div>}
    {tab === "loss" && <div className="lab-content"><div>
      {range("假设本金下跌", loss, 0, 90, 5, setLoss)}
      <p className="planner-help">每次以100元起步。下跌后，回本所需要增长的比例以剩余金额为分母。</p>
    </div><div className="lab-results" aria-live="polite"><div><span>100元下跌后剩余</span><strong>¥{money(100 - loss)}</strong></div>
      <div><span>回本需要再上涨</span><strong>{recoveryReturn(loss).toFixed(2)}%</strong></div>
      <p>{loss} ÷ {100 - loss} × 100%。这只解释算术，不保证回本，也不假设一定会反弹。</p>
    </div></div>}
  </section>;
}

export function LearningCenter({ profile, balances, privacy, topic, selectTopic, plan }: Props) {
  const progress = useLocalRecord("qinglan-learning-v1", {} as Record<string, number>, readLearningProgress);
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const lesson = LESSONS.find(item => item.id === topic) || LESSONS[0];
  const index = LESSONS.indexOf(lesson), complete = progress.record[lesson.id] === lesson.answer;
  const selected = selections[lesson.id], attempted = attempts[lesson.id];
  const passed = Object.keys(progress.record).length;
  const show = (value: number) => privacy ? "••••" : money(value);
  const context: Record<string, string> = {
    cash: `你的月结余：收入 ¥${show(profile.income)} − 生活支出 ¥${show(profile.expense)} − 每月还款 ¥${show(profile.monthlyDebt)} = ${balances.monthlyDeficit ? "缺口" : "结余"} ¥${show(balances.monthlyDeficit || balances.surplus)}。`,
    reserve: `按 ${profile.emergencyMonths} 个月计算，应急金为 ¥${show(balances.emergency)}；再预留目标和额外还款后，当前可新增投资现金为 ¥${show(balances.freeCash)}。`,
    risk: `假设股票类下跌40%、黄金下跌20%，已录入持仓损失约 ¥${show(balances.fundValue * 0.4 + balances.goldValue * 0.2)}；你填写的承受金额为 ¥${show(profile.maxLoss)}。`,
    diversify: `已录入股票类基金仅019442，参考市值 ¥${show(balances.fundValue)}。网站还不能判断你在其他平台是否持有重合的产品。`,
    fees: "用下面的实验室保持本金、收益假设和期限相同，只改变年费。再试一次零收益或负收益情景。",
    qdii: "去持仓页核对“净值所属日”，并用下方汇率实验室验证10%与−5%的组合效果。",
    gold: `已录入黄金参考市值为 ¥${show(balances.goldValue)}；剩余成本为 ¥${show(profile.goldCost)}。市值、成本和卖出到账金额是不同概念。`,
    review: `当前月结余为 ¥${show(balances.surplus)}。去资金规划比较它如何先补预留、再补目标缺口，不自动卖出现有持仓。`,
  };
  function checkAnswer() {
    if (selected === undefined) return;
    setAttempts({ ...attempts, [lesson.id]: selected });
    if (selected === lesson.answer) progress.save({ ...progress.record, [lesson.id]: selected });
  }

  return <div className="learning-center">
    <section className="learning-hero"><div><span className="eyebrow">每天一课，把知识用在自己的钱上</span>
      <h2>学懂一个概念，做出一个判断。</h2><p>8节入门课，配合你的资金示例、随堂题与计算实验。学习进度保存在当前浏览器。</p></div>
      <div className="course-progress"><GraduationCap size={28} /><strong>{passed}<small> / {LESSONS.length}</small></strong><span>节随堂题已答对</span></div>
    </section>
    {progress.error && <p className="warning-box" role="status">{progress.error}</p>}
    <KnowledgeSearch learn={selectTopic} />
    <div className="course-layout">
      <nav className="panel course-navigation" aria-label="学习路径">
        <div className="panel-heading"><h2>从生活到投资</h2><BookOpen size={18} /></div>
        {LESSONS.map((item, order) => <button key={item.id} aria-current={item.id === lesson.id ? "step" : undefined}
          className={item.id === lesson.id ? "active" : ""} onClick={() => selectTopic(item.id)}>
          <span className={`lesson-state ${progress.record[item.id] === item.answer ? "passed" : ""}`}>
            {progress.record[item.id] === item.answer ? <CheckCircle2 size={19} /> : <BookOpen size={18} />}
          </span><span><b>{item.title}</b><small>{item.minutes}分钟 · {progress.record[item.id] === item.answer ? "随堂题已答对" : order <= 2 ? "打好基础" : "学会应用"}</small></span>
        </button>)}
        <p className="planner-help">答对一道题仅代表完成本课练习，不代表产品适当性评级或投资资格。</p>
      </nav>
      <article className="panel lesson-content" aria-labelledby="lesson-title">
        <div className="lesson-label"><span className="badge">约{lesson.minutes}分钟</span>{complete && <span className="badge green">本课随堂题已答对</span>}</div>
        <h2 id="lesson-title">{lesson.title}</h2><p className="lesson-goal">{lesson.goal}</p>
        {lesson.sections.map(section => <section className="lesson-section" key={section.title}><h3>{section.title}</h3><p>{section.text}</p></section>)}
        <aside className="personal-example"><strong>{profile.mode === "demo" ? "用演示资金理解" : "联系你的已录入资金"}</strong>
          <p>{context[lesson.id]}</p><button className="text-button" onClick={plan}>带着这个概念看资金规划</button></aside>
        <fieldset className="lesson-quiz"><legend>用一道题检查理解</legend><p>{lesson.question}</p>
          {lesson.options.map((option, optionIndex) => <label key={option}>
            <input type="radio" name={`quiz-${lesson.id}`} checked={selected === optionIndex}
              onChange={() => { setSelections({ ...selections, [lesson.id]: optionIndex }); setAttempts(previous => {
                const next = { ...previous }; delete next[lesson.id]; return next;
              }); }} /><span>{option}</span>
          </label>)}
          <button className="button primary" disabled={selected === undefined} onClick={checkAnswer}>检查答案</button>
          {attempted !== undefined && <div className={`quiz-feedback ${attempted === lesson.answer ? "correct" : "retry"}`} role="status">
            <strong>{attempted === lesson.answer ? "答对了，记住它的理由。" : "再想一下，关键在这里。"}</strong><p>{lesson.explanation}</p>
          </div>}
        </fieldset>
        <div className="lesson-task"><h3>今天做一件事</h3><p>{lesson.task}</p></div>
        <div className="lesson-source"><span>继续阅读</span><a href={lesson.source.url} target="_blank" rel="noreferrer">{lesson.source.title}</a>
          <small>中文解释、练习与计算示例由本站编写。链接为延伸阅读，具体产品以其现行文件为准。</small></div>
        <div className="lesson-actions"><button className="button secondary" onClick={plan}>去安排我的资金</button>
          <button className="button primary" onClick={() => index < LESSONS.length - 1 ? selectTopic(LESSONS[index + 1].id) : plan()}>
            {index < LESSONS.length - 1 ? "继续下一课" : "把所学用到规划"}</button></div>
      </article>
    </div>
    <LearningLab />
  </div>;
}
