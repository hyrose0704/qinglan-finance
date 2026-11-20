import { BRIEF_SOURCES, signedChange, type BriefMovement, type BriefNews, type MorningEdition } from "./morning-brief.ts";

export interface BriefInterpretation {
  asset: "gold" | "nasdaq";
  title: string;
  observation: string;
  possibleReason: string;
  counterEvidence: string;
  watch: string;
  sources: { title: string; url: string }[];
}

const navPage = { title: "万家基金 · 019442 产品与公告", url: "https://www.wjasset.com/products/qdii/019442/index.html" };
const realYieldPage = { title: "FRED · 美国十年期实际收益率", url: "https://fred.stlouisfed.org/series/DFII10" };
const sgeSessionPage = { title: "上金所 · Au99.99 常规交易时间", url: "https://www.sge.com.cn/h5_cpfw/Au9999H5" };
const nasdaqCalendar = { title: "纳斯达克 · 美股交易日历", url: "https://www.nasdaq.com/market-activity/stock-market-holiday-schedule" };
const nyClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
});
const beijingClock = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function readableChange(move?: BriefMovement) {
  return move?.value != null && move.change != null && Number.isFinite(move.change) ? move.change : null;
}

function direction(change: number) {
  return Math.abs(change) < 0.005 ? 0 : Math.sign(change);
}

function quoteSource(move: BriefMovement) {
  return { title: move.name + " · " + move.source, url: move.url };
}

function headlineSource(item: BriefNews, label: string) {
  const publisher = BRIEF_SOURCES.find(source => source.id === item.sourceId)?.name;
  return { title: `${label} · 北京时间 ${beijingClock.format(new Date(item.publishedAt))} · ${publisher} · ${item.title}`, url: item.url };
}

function subject(item: BriefNews) {
  if (item.sourceId === "fed") return /minutes|纪要/i.test(item.title) ? "美联储会议纪要" : "美联储政策公告";
  if (item.sourceId === "cpi") return "美国 CPI 公告";
  const companies: [RegExp, string][] = [
    [/nvidia|英伟达/i, "英伟达"], [/\bamd\b|超威半导体/i, "AMD"], [/\bapple\b|苹果/i, "苹果"],
    [/microsoft|微软/i, "微软"], [/amazon|亚马逊/i, "亚马逊"], [/\bmeta\b/i, "Meta"],
    [/broadcom|博通/i, "博通"], [/alphabet|google|谷歌/i, "Alphabet"],
  ];
  const names = companies.filter(([pattern]) => pattern.test(item.title)).map(([, name]) => name);
  let topic = names.join("、");
  if (!topic) topic = item.topics.includes("gold") ? "黄金" : /chips?|semiconductor|芯片/i.test(item.title) ? "芯片行业" : "纳指";
  if (/earnings|guidance|forecast|quarterly results|业绩|财报|指引/i.test(item.title)) return topic + "业绩报道";
  if (/export|licen[cs]e|approved sales|restriction|出口|许可/i.test(item.title)) return topic + "销售政策报道";
  if (/short seller|investigation|subpoena|alleg|probe|做空|调查/i.test(item.title)) return topic + "争议报道";
  return topic + "报道";
}

function usPublicationWindow(item: BriefNews, day: string): "before" | "candidate" | "check-close" | "after" {
  const parts = Object.fromEntries(nyClock.formatToParts(new Date(item.publishedAt)).map(part => [part.type, part.value]));
  const localDay = `${parts.year}-${parts.month}-${parts.day}`;
  // After the previous regular close or before 13:00 on the review day is unambiguous
  // without a holiday/early-close calendar. Later publications remain follow-up material.
  if (localDay < day) return Number(parts.hour) >= 16 ? "candidate" : "before";
  if (localDay > day || Number(parts.hour) >= 16) return "after";
  return Number(parts.hour) < 13 ? "candidate" : "check-close";
}

function goldAnalysis(edition: MorningEdition, movements: BriefMovement[], news: BriefNews[], weekend: boolean): BriefInterpretation {
  const domestic = movements.find(row => row.id === "domestic");
  const international = movements.find(row => row.id === "gold");
  const dxy = movements.find(row => row.id === "dxy");
  const cn = readableChange(domestic), usdGold = readableChange(international), dollar = readableChange(dxy);
  const facts = [domestic, international, dxy].filter((row): row is BriefMovement => readableChange(row) !== null);
  const weekendLocalGap = weekend && domestic?.value == null;
  const goldNews = news.filter(item => item.topics.includes("gold") || item.sourceId === "fed" || item.sourceId === "cpi");
  const changes = facts.map(row => row.name + " " + signedChange(row.change!)).join("，");
  if (weekendLocalGap && international?.value == null) {
    const headline = goldNews[0];
    return {
      asset: "gold", title: "周末怎样跟踪黄金",
      observation: `${edition.reviewDate} 为周末，本期未取得该日 Au99.99 及国际黄金收盘。${changes ? changes + "。" : ""}`,
      possibleReason: "缺少当天正式金价，周末消息留到开市后检验。",
      counterEvidence: "周五收盘与下次开盘属于不同交易时点。跨休市期的变动应保留两个实际日期。",
      watch: (headline ? `跟踪${subject(headline)}公布后的首个可比报价。` : "") +
        "查看上金所下一交易日安排，再用新公布的克价与上个正式收盘比较，节假日以交易所公告为准。",
      sources: [...facts.map(quoteSource), ...(headline ? [headlineSource(headline, "周末跟踪")] : []), sgeSessionPage],
    };
  }
  const observation = (weekendLocalGap ? `${edition.reviewDate} 为周末，本期未取得该日 Au99.99 正式收盘。` :
    cn === null ? "本期缺少 Au99.99 可比较的收盘涨跌。" : "") + (changes ? changes + "。" : "国际黄金和美元的日线对照也待补齐。");
  let possibleReason = "要检验美元对金价的影响，还需同一复盘日的国际黄金和美元指数涨跌。";
  if (usdGold !== null && dollar !== null) {
    const product = direction(usdGold) * direction(dollar);
    if (product < 0) possibleReason = dollar > 0
      ? "国际金价走低、美元走强，方向符合美元升值压低美元计价金价的解释。还要核对两者变动的先后。"
      : "国际金价走高、美元走弱，方向符合弱美元降低其他货币买家购金成本的解释。还要核对两者变动的先后。";
    else if (product > 0) possibleReason = "国际金价和美元同向变化，常见的美元反向定价解释在这一天证据较弱。可检验实际收益率或避险需求是否有独立变化。";
    else possibleReason = "至少一项涨跌在两位小数下接近零，美元方向对这天国际金价的解释力有限。";
  }
  const divergent = cn !== null && usdGold !== null && direction(cn) * direction(usdGold) < 0;
  const counterEvidence = (divergent ? "国内与国际金价本期反向，更需核对人民币汇率和境内供需。" : "美元指数衡量一篮子货币，换算人民币克价须另查美元兑人民币。") +
    (international?.name.includes("期货") ? "国际对照采用期货，合约基差和收盘时点也会影响比较。" : "上海与海外收盘时点不同，日涨跌的差额不能直接计为境内溢价。");
  const article = !weekendLocalGap && goldNews.find(item => Date.parse(item.publishedAt) < Date.parse(edition.reviewDate + "T15:30:00+08:00"));
  const later = goldNews.find(item => weekendLocalGap || Date.parse(item.publishedAt) >= Date.parse(edition.reviewDate + "T15:30:00+08:00"));
  const sources = facts.map(quoteSource);
  if (article) {
    sources.push(headlineSource(article, "常规日盘截止前线索"));
    possibleReason += `${subject(article)}在复盘日北京时间${beijingClock.format(new Date(article.publishedAt)).slice(-5)}发布，早于常规日盘截止。可比对发布前后的实际利率和金价。`;
  }
  if (later) sources.push(headlineSource(later, "后续跟踪"));
  if (article || later) sources.push(sgeSessionPage);
  sources.push(realYieldPage);
  let watch = weekendLocalGap ? "核对上金所交易日历，在下一次有正式收盘时比较国内克价。" : cn === null ? "先等上金所公布复盘日收盘与比较值。" :
    "先把同一时点的美元金价乘美元兑人民币，再除以31.1035换算元/克，对照 Au99.99。";
  watch += later ? weekendLocalGap ? `${subject(later)}留到下一交易时段检验。` : `${subject(later)}在常规日盘15:30截止后或截止时才发布，留待下一交易时段检验，临时调整以交易所公告为准。` :
    "再查十年期实际收益率，若金价上涨时实际收益率也上行，持金机会成本下降的解释就会减弱。";
  return { asset: "gold", title: "人民币金价受什么影响", observation, possibleReason, counterEvidence, watch, sources };
}

function indexAnalysis(edition: MorningEdition, movements: BriefMovement[], news: BriefNews[], weekend: boolean): BriefInterpretation {
  const index = movements.find(move => move.id === "nasdaq"), fund = movements.find(move => move.id === "fund");
  const equity = readableChange(index), nav = readableChange(fund);
  const weekendIndexGap = weekend && index?.value == null, weekendNavGap = weekend && fund?.value == null;
  const isEquity = (item: BriefNews) => item.topics.includes("equity") &&
    /nasdaq|nvidia|apple|microsoft|amazon|meta platforms|broadcom|alphabet|google|\bamd\b|\bchips?\b|semiconductor|芯片|纳指|英伟达|微软|苹果/i.test(item.title);
  const isMacro = (item: BriefNews) => item.sourceId === "fed" || item.sourceId === "cpi";
  if (weekendIndexGap && weekendNavGap) {
    const headline = news.find(item => isEquity(item) || isMacro(item));
    return {
      asset: "nasdaq", title: "周末怎样跟踪纳指基金",
      observation: `${edition.reviewDate} 为周末，美股通常没有常规收盘，本期也未取得该日的 019442 净值。`,
      possibleReason: "本期没有可供归因的指数或基金日涨跌。",
      counterEvidence: "北京时间周六清晨看到的美股周五收盘，仍归属美东周五交易日。",
      watch: (headline ? `开盘后核对${subject(headline)}公布后的价格反应。` : "") +
        "按美股交易日历核对下次收盘，再查万家基金公告的净值所属日。两地节假日和估值安排可能不同。",
      sources: [nasdaqCalendar, navPage, ...(headline ? [headlineSource(headline, "周末跟踪")] : [])],
    };
  }
  const observation = (weekendIndexGap ? "复盘日为周末，本期未取得纳指100该日正式收盘。" :
    equity === null ? "本期缺少纳指100可比较的收盘涨跌。" : `纳指100收盘 ${signedChange(equity)}。`) +
    (weekendNavGap ? "复盘日为周末，本期未取得 019442 该日净值。" :
      nav === null ? "019442 缺少复盘日可比较的人民币净值涨跌。" : `019442 同一标注日期的人民币净值变化 ${signedChange(nav)}。`);
  const eligible = news.filter(item => !weekendIndexGap && usPublicationWindow(item, edition.reviewDate) === "candidate");
  const companyItem = eligible.find(isEquity), event = companyItem || eligible.find(isMacro);
  const followUp = news.find(item => (isEquity(item) || isMacro(item)) && ["check-close", "after"].includes(usPublicationWindow(item, edition.reviewDate)));
  let possibleReason = "本期缺少能与指数交易窗口对齐的企业或美国政策线索。可分别查权重股盈利预期和折现率，日线本身无法区分这两种驱动。";
  if (weekendIndexGap) possibleReason = "复盘日缺少指数日线，可从基金披露的估值时点和汇率查证净值变化。";
  else if (equity === null) possibleReason = "指数该日的收盘变化尚待补齐，暂时无法检验本期消息与指数方向的关系。";
  else if (companyItem) {
    const headline = companyItem.title, name = subject(companyItem);
    if (/earnings|guidance|forecast|quarterly results|业绩|财报|指引/i.test(headline))
      possibleReason = `本期的${name}提供了检验线索。将正式财报与公告前的同口径预期比较，若盈利预期改变，再查相关股票对纳指的实际贡献。`;
    else if (/export|licen[cs]e|approved sales|restriction|出口|许可/i.test(headline))
      possibleReason = `本期的${name}涉及销售许可或出口限制，可能先影响可交付订单和收入预期。核对政策适用范围、公司指引和成分股权重，可检验它对指数的重要性。`;
    else if (/short seller|investigation|subpoena|alleg|probe|做空|调查/i.test(headline))
      possibleReason = `本期的${name}涉及调查或市场指控，可能影响相关股票的风险折价。需核对原始文件、公司回应及个股涨跌贡献，报道本身无法确认指控。`;
    else possibleReason = `本期可用${name}核对指数驱动。若相关成分股同方向变动且期初权重大，它们会放大指数的涨跌。`;
  } else if (event?.sourceId === "fed")
    possibleReason = `${subject(event)}提供了政策预期可能改变的时点。若随后收益率上行，远期盈利的折现价值会承压；若收益率几乎未动，这个解释较弱。`;
  else if (event?.sourceId === "cpi")
    possibleReason = "美国 CPI 发布可能先改变市场对利率路径的预期，再影响科技股估值。先核对公布值与事前预期的差异，以及公布后收益率的方向。";
  else if (followUp && usPublicationWindow(followUp, edition.reviewDate) === "check-close")
    possibleReason = `${subject(followUp)}在美东下午发布。先核对当天实际收盘时刻，若公布早于收盘，再比较消息前后的指数反应。提前收盘后的消息只作后续观察。`;
  const opposite = nav !== null && equity !== null && direction(nav) * direction(equity) < 0;
  const counterEvidence = opposite ? "本期净值与指数方向相反。检查基金估值日对应的海外交易时段、换汇价格及实际仓位，仅用美元计价的纳指收益解释不通。" :
    "美股收盘在北京时间次日。基金估值时点、美元兑人民币、现金仓位和跟踪差异都可能改变人民币回报，单只股票的新闻也不足以解释整个指数。";
  const watch = (weekendNavGap ? "查看万家公告的下一净值及其估值日期，节假日以基金管理人安排为准。" :
    nav === null ? `先查万家基金是否公布 ${edition.reviewDate} 的 019442 净值，并核对上一净值日及分红。` :
    "核对净值对应的海外交易时段和估值汇率，再比较人民币口径的跟踪差异。") +
    (companyItem ? "查相关成分股期初权重乘以当日涨跌，看看它能解释多少指数变化。" :
      followUp ? `跟踪${subject(followUp)}的后续原始披露及下一个美股交易时段的反应。` :
        "若收益率变化很小，下一步查主要成分股盈利消息和涨跌贡献。");
  const sources = [index, fund].filter((row): row is BriefMovement => readableChange(row) !== null).map(quoteSource);
  if (event) sources.push(headlineSource(event, "交易窗口线索"));
  if (followUp) sources.push(headlineSource(followUp, weekendIndexGap ? "周末跟踪" :
    usPublicationWindow(followUp, edition.reviewDate) === "after" ? "美股收盘后跟踪" : "需核对美股收盘时刻"));
  if (!sources.some(item => item.url === navPage.url)) sources.push(navPage);
  return { asset: "nasdaq", title: "纳指涨跌如何传到基金", observation, possibleReason, counterEvidence, watch, sources };
}

export function interpretMorningEdition(edition: MorningEdition): BriefInterpretation[] {
  const movements = edition.movements.filter(row => row.date === edition.reviewDate);
  const start = Date.parse(edition.reviewDate + "T00:00:00+08:00"), cutoff = Date.parse(edition.cutoff);
  const news = edition.news.filter(item => {
    const time = Date.parse(item.publishedAt);
    return time >= start && time <= cutoff;
  });
  const weekday = new Date(edition.reviewDate + "T00:00:00Z").getUTCDay(), weekend = weekday === 0 || weekday === 6;
  return [goldAnalysis(edition, movements, news, weekend), indexAnalysis(edition, movements, news, weekend)];
}
