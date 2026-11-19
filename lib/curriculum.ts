export interface Lesson {
  id: string;
  title: string;
  minutes: number;
  goal: string;
  sections: { title: string; text: string }[];
  question: string;
  options: string[];
  answer: number;
  explanation: string;
  task: string;
  source: { title: string; url: string };
}

export const LESSONS: Lesson[] = [
  {
    id: "cash", title: "先看现金流，再谈收益", minutes: 5,
    goal: "分清资产、成本、月结余和真正能动用的钱。",
    sections: [
      { title: "资产不是收入", text: "现金、黄金和基金的参考市值可以相加；基金上涨的浮盈不能当作每月固定收入。剩余持仓成本用来算盈亏，不能再从总资产中重复扣除。" },
      { title: "先算生活能否持续", text: "月结余 = 税后收入 − 生活与固定支出 − 每月还款。结果为负时，先处理现金流缺口；把资产收益率调高并不能修复每月确定发生的支出。" },
      { title: "一次性预留单独记录", text: "每月正常还款和额外一次性还款不是同一笔。明确用款、应急金也应避免重复填报。当前网站只统计现金、黄金和019442，其他资产与全部负债还未覆盖。" },
    ],
    question: "每月收入10,000元，生活支出6,000元，还款2,000元。可规划月结余是多少？",
    options: ["4,000元", "2,000元", "加上基金浮盈后再算"], answer: 1,
    explanation: "10,000 − 6,000 − 2,000 = 2,000元。未实现收益不列入固定收入。",
    task: "核对收入、支出与还款字段，确认同一笔费用没有填两次。",
    source: { title: "Investor.gov · 梳理个人财务", url: "https://www.investor.gov/introduction-investing/investing-basics/save-and-invest/figure-out-your-finances" },
  },
  {
    id: "reserve", title: "给生活和目标留出位置", minutes: 6,
    goal: "知道为什么先留钱，以及哪些钱不适合承担大波动。",
    sections: [
      { title: "应急金解决意外", text: "应急金用于失业、疾病或临时开支。金额可用必要月支出乘预留月数估算，再结合收入稳定性和家庭责任调整。网站按必要月支出和预留月数计算。月数留空按0保存，表示尚未设置预留，不代表无需应急金。" },
      { title: "目标资金解决确定用途", text: "未来1—3年明确要用的钱与应急金分别预留。选工具时先检查能否及时取出、期限是否匹配、提前支取代价和净值波动，再比较收益。" },
      { title: "把投入能力算成金额", text: "可新增投资现金 = max(0，现金 − 应急金 − 近期用款 − 额外还款预留)。已有黄金和基金仍是资产，但不能自动算作随时可用的现金。" },
    ],
    question: "半年后确定要支付的学费，应该怎样安排？",
    options: ["放入波动大的基金等待上涨", "与长期投资混在一起", "单独预留并匹配到账时间"], answer: 2,
    explanation: "付款时间确定，优先考虑流动性和金额能否按时到位。基金可能恰好在用款时下跌或尚未到账。",
    task: "把近期明确用款从长期投资资金中划出，再核对应急金是否真实可用。",
    source: { title: "Investor.gov · 应急储蓄", url: "https://www.investor.gov/introduction-investing/investing-basics/save-and-invest/save-rainy-day" },
  },
  {
    id: "risk", title: "把风险换算成损失金额", minutes: 5,
    goal: "区分愿意承受、实际有能力承受和情景假设。",
    sections: [
      { title: "长期不用，也不代表能够无限亏损", text: "风险承受意愿是你面对亏损时的感受；承受能力还取决于收入、债务、用款时间和家庭责任。网站只做简化的学习测算，不能代替完整的适当性评估。" },
      { title: "用金额理解回撤", text: "假设股票类跌40%、黄金跌20%，分别用持有市值乘跌幅再相加。它描述一个指定情景，不是预测，也不是最坏情况。多类资产可以同时下跌。" },
      { title: "亏损与回本不对称", text: "100元跌20%剩80元，回到100元需要涨25%。减少不必要的风险，通常比盯着一个更高的预期收益数字更容易落实。下方实验室可以自己改变跌幅。" },
    ],
    question: "100元跌去50%后，要涨多少才能回到100元？",
    options: ["50%", "75%", "100%"], answer: 2,
    explanation: "剩余50元，需要再赚50元。50 ÷ 50 = 100%，不是50%。",
    task: "填写能承受的亏损金额，并比较现有持仓在假设跌幅下是否超出它。",
    source: { title: "Investor.gov · 理解投资风险", url: "https://www.investor.gov/introduction-investing/investing-basics/what-risk" },
  },
  {
    id: "diversify", title: "分散投资，也要看底层持仓", minutes: 6,
    goal: "看懂资产类别、基金名称和实际风险之间的区别。",
    sections: [
      { title: "先看大类，再看产品", text: "资金用途和投资期限先决定哪些风险值得承担，再比较现金工具、债券、股票类基金和黄金。不同产品有各自的流动性、费用和亏损风险，不能只按历史收益排序。" },
      { title: "买了多只基金，仍可能集中", text: "如果几只基金都跟踪相似指数、重仓同一行业，它们可能同时下跌。核对投资范围、主要持仓、行业和地区，比数基金只数更有帮助。" },
      { title: "纳指不代表全部股票资产", text: "019442对应纳斯达克100指数，它只是当前记录的一类持仓。规划中的“股票类”是资产类别比较，不能直接理解为全部购买这一只基金。网站尚未自动读取所有基金持仓重合度。" },
    ],
    question: "同时持有三只跟踪同一指数的基金，说明什么？",
    options: ["已充分分散到三个不同市场", "底层风险仍可能高度重合", "亏损风险一定只有原来的三分之一"], answer: 1,
    explanation: "产品数量增加不等于风险来源增加，需要检查底层资产是否重合。分散也不保证不亏损。",
    task: "列出你持有的产品和它们实际投资的地区、行业、资产类别。",
    source: { title: "Investor.gov · 资产配置与分散", url: "https://www.investor.gov/introduction-investing/getting-started/asset-allocation" },
  },
  {
    id: "fees", title: "复利里，也有费用的累积", minutes: 6,
    goal: "比较到手结果，而不只比较宣传收益。",
    sections: [
      { title: "先把费用找齐", text: "申购费、赎回费、持续收取的管理与托管等费用，计费方式和适用条件可能不同。比较同类产品时，把持有期限、金额和收费规则一起看，具体以产品文件为准。" },
      { title: "费用会减少继续参与增长的本金", text: "持续费用不仅影响当期金额，也影响后续可参与收益的资金。实验室用恒定收益和年末等效费用作演示，不模拟某只基金实际每天的计提方式。" },
      { title: "假设收益率不等于未来收益率", text: "你可以同时试正收益、零收益与负收益情景。现实收益会波动；顺序、税费、交易费用和申赎时点都会改变结果。不要用一个漂亮的复利终值代替风险分析。" },
    ],
    question: "比较长期持有的两只同类基金，哪些信息应一起查看？",
    options: ["历史涨幅、持续费用、交易费用与持有规则", "只看最近一个月排名", "只看基金名字是否熟悉"], answer: 0,
    explanation: "结果取决于收益与成本，也取决于期限和产品规则。短期排名不能替代这些检查。",
    task: "在复利与费用实验室中，把年费从0.5%改为1.5%，保持其他假设相同进行比较。",
    source: { title: "Investor.gov · 理解费用", url: "https://www.investor.gov/introduction-investing/getting-started/understanding-fees" },
  },
  {
    id: "qdii", title: "QDII：指数涨了，我为何没同幅上涨", minutes: 6,
    goal: "分清指数、期货、汇率、公布净值和申赎价格。",
    sections: [
      { title: "人民币收益隔着汇率", text: "在不做汇率对冲、忽略费用和跟踪差异的简化情景下，人民币收益 ≈ (1 + 海外资产收益) × (1 + 外币兑人民币变化) − 1。人民币走强可能抵消部分海外资产涨幅。" },
      { title: "先对齐日期和口径", text: "海外指数、期货和基金净值可能来自不同交易时段。已公布净值有自己的所属日期，不能拿今天的指数变化直接当作今天可成交的基金收益。" },
      { title: "交易规则同样影响安排", text: "QDII还需核对申购限制、休市安排、确认与赎回到账时间。当前页面的019442状态和净值用于观察，实际额度和成交规则以基金公司及销售平台最新披露为准。" },
    ],
    question: "假设美元资产涨10%，美元兑人民币跌5%，忽略其他因素，人民币收益约多少？",
    options: ["15%", "5%", "4.5%"], answer: 2,
    explanation: "1.10 × 0.95 − 1 = 4.5%。这只是未对冲且忽略费用等因素的计算示例。",
    task: "核对持仓页的净值所属日，再在汇率实验室中改变两项涨跌幅。",
    source: { title: "上海市基金同业公会 · QDII基础与汇率风险", url: "https://www.samacn.org.cn/d_9003_79062.html" },
  },
  {
    id: "gold", title: "黄金：先看角色，再看价格", minutes: 5,
    goal: "理解配置、报价与实际卖出金额的区别。",
    sections: [
      { title: "黄金也会明显下跌", text: "黄金可以是一类配置资产，但价格仍可能剧烈波动，不能把它当作应急金的等价物。固定买入预算也不自动说明仓位合适，需要和总资产、目标和损失承受金额一起比较。" },
      { title: "理论折算不是成交报价", text: "国际美元每盎司报价乘美元兑人民币、再除以31.1034768，可以得到理论人民币每克价格。境内溢价、平台买卖点差、赎回费用和报价时点会让实际金额不同。" },
      { title: "分清普通持有与杠杆交易", text: "实物、积存金、黄金基金和保证金产品的规则不同。这里按不加杠杆的持有市值计算，不适用于需要追加保证金的交易。价格线索只能辅助理解，不能单独证明当日涨跌原因。" },
    ],
    question: "国际金价折算得到每克价格后，能否直接当作平台卖出到账金额？",
    options: ["可以，所有平台报价都一致", "还要核对平台点差、费用和报价时间", "只要金价上涨就没有费用"], answer: 1,
    explanation: "理论折算没有涵盖境内价差、平台规则和卖出费用。成交前必须使用对应平台的有效报价。",
    task: "核对黄金份额、剩余持仓成本与平台实际卖出报价，再查看它占总资产多少。",
    source: { title: "上海黄金交易所 · 仓位与市场风险提示（2025-04-10）", url: "https://www.sge.com.cn/jjsnotice/10006628" },
  },
  {
    id: "review", title: "执行与复盘：让计划跟得上生活", minutes: 5,
    goal: "知道何时重算、先用什么方式调整，以及应当记录什么。",
    sections: [
      { title: "先按生活变化重算", text: "收入、债务、家庭责任或用款时间变化时，先更新资金档案。价格每天波动，不代表长期目标每天都改变。按固定节奏回看，能让调整有依据。" },
      { title: "先比较新增资金，再比较买卖", text: "新增结余可以先补充低于目标的类别，减少为调整而反复交易。如果仍需卖出，先核对费用、税费、到账时间与实际用途。目标是比较基准，不是强制下单指令。" },
      { title: "记录决策理由", text: "保存当时的目标、投入金额、产品规则和触发复查的条件。复盘时比较自己的流程是否可靠，同时区分市场变化、现金流变化与费用影响。短期盈利不能单独证明方法正确。" },
    ],
    question: "组合偏离目标后，第一步适合做什么？",
    options: ["不看费用立刻全部买卖一次", "检查目标是否变化，再比较用新资金补缺口", "只追加最近涨得最多的资产"], answer: 1,
    explanation: "先核对目标与约束，再比较新增资金和交易成本。网站只计算候选金额，具体交易仍需你在原平台确认。",
    task: "为下一次复查设定一个时间，并写下收入或用款变化时要重新计算的条件。",
    source: { title: "Investor.gov · 配置与再平衡", url: "https://www.investor.gov/additional-resources/general-resources/publications-research/info-sheets/beginners-guide-asset" },
  },
];

export function readLearningProgress(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const answers = value as Record<string, unknown>;
  return Object.fromEntries(LESSONS.filter(lesson => answers[lesson.id] === lesson.answer)
    .map(lesson => [lesson.id, lesson.answer]));
}
