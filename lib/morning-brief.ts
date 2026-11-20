import { beijingDay, shiftDay, type DomesticGold, type DomesticGoldDay } from "./domestic-gold.ts";
import type { Point } from "./market.ts";
import { fundMovement, goldComparison, isCalendarDay, FUND_DISCLOSURE_URL, EASTMONEY_FUND_URL, MISSING_NAV_COMPARISON, type NavObservation, type NavProvider } from "./brief-prices.ts";

export const BRIEF_SOURCES = [
  { id: "cnbc", name: "CNBC · 财经新闻", host: "www.cnbc.com", feed: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { id: "fed", name: "美联储 · 货币政策", host: "www.federalreserve.gov", feed: "https://www.federalreserve.gov/feeds/press_monetary.xml" },
  { id: "cpi", name: "美国劳工统计局 · CPI", host: "www.bls.gov", feed: "https://www.bls.gov/feed/cpi.rss" },
] as const;
export type BriefTopic = "gold" | "rates" | "equity" | "fx";
export interface BriefNews {
  sourceId: string; title: string; url: string; publishedAt: string; period: "previous-day" | "overnight";
  topics: BriefTopic[]; note: string;
}
export interface BriefSource { id: string; status: "fetched" | "unavailable"; checkedAt: string | null; count: number }
export interface BriefMovement {
  id: string; name: string; unit: string; value: number | null; change: number | null; date: string | null;
  source: string; url: string; low?: number; high?: number; collectedAt?: string;
  previousValue?: number; previousDate?: string; latestAvailable?: Point; comparisonNote?: string; supplementedAt?: string;
}
export interface BriefAnalysis { title: string; text: string; references: string[] }
export interface MorningEdition {
  date: string; reviewDate: string; cutoff: string; generatedAt: string; updatedAt?: string; status: "ready" | "partial";
  overview: string; movements: BriefMovement[]; news: BriefNews[]; analysis: BriefAnalysis[]; gaps: string[]; sources: BriefSource[];
}
export interface BriefArchive { version: 1; editions: MorningEdition[] }

export function morningWindow(now: number) {
  const today = beijingDay(now), todayCutoff = Date.parse(`${today}T09:00:00+08:00`);
  const date = now < todayCutoff ? shiftDay(today, -1) : today, reviewDate = shiftDay(date, -1);
  return { date, reviewDate, start: Date.parse(`${reviewDate}T00:00:00+08:00`), midnight: Date.parse(`${date}T00:00:00+08:00`),
    cutoff: `${date}T09:00:00+08:00` };
}
export function signedChange(value: number): string {
  const rounded = Math.abs(value) < 0.005 ? 0 : value;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(2)}%`;
}
function plain(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => { const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; })
    .replace(/\s+/g, " ").trim();
}
function tag(raw: string, name: string): string { return plain(raw.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || ""); }
function trustedUrl(value: string, host: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === host && !url.username && !url.password && !url.port; }
  catch { return false; }
}
function identifyNews(text: string): { topics: BriefTopic[]; note: string } {
  const topics: BriefTopic[] = [];
  if (/\bgold\b|precious metal|黄金|金价/i.test(text)) topics.push("gold");
  if (/federal reserve|federal open market committee|\bfed\b|interest rate|inflation|consumer price index|\bcpi\b|fomc|monetary|美联储|利率|通胀/i.test(text)) topics.push("rates");
  if (/nasdaq|s&p\s*500|\bstock\b|equities|nvidia|\bamd\b|chip|ai trade|earnings|纳指|美股|科技股/i.test(text)) topics.push("equity");
  if (/\bdollar\b|currenc|forex|yuan|renminbi|美元|人民币|汇率/i.test(text)) topics.push("fx");
  const drivers = [
    /higher (?:interest )?rates|rate hikes?|加息|更高利率/i.test(text) ? "较高利率或加息预期" : "",
    /stronger dollar|dollar (?:rall|ris|gain)|美元走强/i.test(text) ? "美元走强" : "",
  ].filter(Boolean);
  const note = topics.includes("gold") ? drivers.length ? `报道摘要将黄金表现与${drivers.join("、")}联系起来；这是解释线索，仍需与当日数据对照。`
    : "报道讨论黄金表现，需进一步核对利率、汇率和资金流证据。"
    : topics.includes("equity") && /subpoena|short seller|investigation|probe|调查|做空/i.test(text)
      ? "报道涉及科技企业的调查或做空争议，应核对原始文件与公司回应；个股事件不能直接代表整个指数。"
      : topics.includes("rates") ? "涉及通胀或货币政策，需区分实际公布值、市场预期与发言内容。"
      : topics.includes("equity") ? "涉及美股、科技或企业经营，需结合指数权重和整体风险偏好观察。"
      : "涉及汇率变化；人民币计价资产还需区分海外价格、汇率与费用。";
  return { topics, note };
}
export function parseMorningFeed(xml: string, sourceId: string, now: number): BriefNews[] {
  const source = BRIEF_SOURCES.find(row => row.id === sourceId), window = morningWindow(now), cutoff = Date.parse(window.cutoff);
  if (!source || xml.length > 2000000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) return [];
  const seen = new Set<string>();
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].flatMap(match => {
    const raw = match[1], title = tag(raw, "title"), url = tag(raw, "link"), date = tag(raw, "pubDate");
    if (!/(?:GMT|UTC|[+-]\d{2}:?\d{2}|T[^ ]*Z)\s*$/i.test(date)) return [];
    const time = Date.parse(date);
    if (!title || !trustedUrl(url, source.host) || seen.has(url) || !Number.isFinite(time) || time < window.start || time > cutoff || time > now) return [];
    const identified = identifyNews(`${title} ${tag(raw, "description")}`);
    if (!identified.topics.length) return [];
    seen.add(url);
    const words = title.split(" "), bounded = words.length > 24 ? words.slice(0, 24).join(" ") + "…" : title.slice(0, 160);
    return [{ sourceId, title: bounded, url, publishedAt: new Date(time).toISOString(),
      period: (time < window.midnight ? "previous-day" : "overnight") as BriefNews["period"], ...identified }];
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
function selectNews(news: BriefNews[]): BriefNews[] {
  const sorted = [...news].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)), selected: BriefNews[] = [];
  const add = (row?: BriefNews) => { if (row && !selected.some(old => old.url === row.url)) selected.push(row); };
  add(sorted.find(row => row.topics.includes("gold")));
  add(sorted.find(row => row.sourceId !== "cnbc"));
  if (!selected.some(row => row.period === "previous-day")) add(sorted.find(row => row.period === "previous-day"));
  for (const topic of ["gold", "rates", "equity", "fx"] as BriefTopic[]) {
    if (selected.some(row => row.topics.includes(topic))) continue;
    const row = sorted.find(item => item.topics.includes(topic) && !selected.some(old => old.url === item.url));
    if (row) selected.push(row);
  }
  for (const row of sorted) if (selected.length < 6 && !selected.some(old => old.url === row.url)) selected.push(row);
  return selected.slice(0, 6);
}
function dailyMove(id: string, name: string, unit: string, rows: Point[], day: string, url: string): BriefMovement {
  const valid = rows.filter(row => isCalendarDay(row.date) && row.date <= day && Number.isFinite(row.value) && row.value > 0).sort((a, b) => a.date.localeCompare(b.date));
  const last = valid.find(row => row.date === day), previous = valid.filter(row => row.date < day).at(-1);
  const pair = last && previous && Date.parse(day) - Date.parse(previous.date) <= 10 * 86400000
    ? { previousValue: previous.value, previousDate: previous.date, change: (last.value / previous.value - 1) * 100 } : { change: null };
  return { id, name, unit, value: last?.value || null, date: last?.date || null, source: "东方财富 · 日线", url, ...pair };
}
export function buildMorningEdition(input: { now: number; observedAt?: number; domestic: DomesticGold | null; domesticHistory?: DomesticGoldDay[]; fundHistory?: NavObservation[]; fundProvider?: NavProvider;
  spot: Point[]; goldFallback?: Point[]; nasdaq: Point[]; dxy: Point[]; news: BriefNews[]; sources: BriefSource[]; previous?: MorningEdition }): MorningEdition {
  const window = morningWindow(input.now);
  const observedAt = new Date(input.observedAt ?? input.now).toISOString();
  const sameIssue = input.previous?.date === window.date ? input.previous : undefined;
  const domestic = input.domesticHistory?.find(row => row.date === window.reviewDate) ?? input.domestic?.daily.find(row => row.date === window.reviewDate);
  const domesticMove: BriefMovement = { id: "domestic", name: "国内现货 Au99.99", unit: "元/克", value: domestic?.close || null,
    change: domestic?.change ?? null, date: domestic?.date || null, source: "上海黄金交易所 · 收盘", url: `https://www.sge.com.cn/sjzx/quotation_daily_new?start_date=${window.reviewDate}&end_date=${window.reviewDate}`,
    ...(domestic ? { low: domestic.low, high: domestic.high,
      ...goldComparison(domestic, input.domesticHistory ?? input.domestic?.daily ?? []) } : {}) };
  let useFutures = !input.spot.some(row => row.date === window.reviewDate && row.value > 0) && !!input.goldFallback?.some(row => row.date === window.reviewDate && row.value > 0);
  const movements = [domesticMove,
    dailyMove("gold", useFutures ? "COMEX黄金连续期货" : "国际现货黄金", "美元/盎司", useFutures ? input.goldFallback! : input.spot, window.reviewDate,
      useFutures ? "https://quote.eastmoney.com/globalfuture/GC.html" : "https://quote.eastmoney.com/globalfuture/XAU.html"),
    dailyMove("nasdaq", "纳斯达克100指数", "点", input.nasdaq, window.reviewDate, "https://quote.eastmoney.com/gb/zsNDX.html"),
    dailyMove("dxy", "美元指数", "点", input.dxy, window.reviewDate, "https://quote.eastmoney.com/zsUDI.html"),
    fundMovement(input.fundHistory || [], window.reviewDate, input.fundProvider)];
  for (let index = 0; index < movements.length; index++) {
    const move = movements[index];
    if (move.value !== null || move.latestAvailable) move.collectedAt = observedAt;
    const old = sameIssue?.movements.find(row => row.id === move.id);
    if (move.id === "fund" && move.value !== null && sameIssue &&
      (!old || old.value === null || old.value !== move.value || old.previousValue === undefined && move.previousValue !== undefined)) {
      move.supplementedAt = move.collectedAt;
    }
    if (!old) continue;
    // Keep the first observation time when a later polling run returns the same data.
    const unchanged = move.value === old.value && move.change === old.change && move.previousValue === old.previousValue && move.previousDate === old.previousDate
      && move.latestAvailable?.value === old.latestAvailable?.value && move.latestAvailable?.date === old.latestAvailable?.date && move.name === old.name;
    const lost = old.value !== null && (move.value === null
      || old.value === move.value && old.previousValue !== undefined && move.previousValue === undefined
        && (move.id !== "fund" || move.comparisonNote === MISSING_NAV_COMPARISON)
      || old.change !== null && move.change === null && move.id !== "fund");
    const lostLatest = old.latestAvailable && move.value === null && (!move.latestAvailable || move.latestAvailable.date < old.latestAvailable.date);
    if ((unchanged && old.collectedAt) || lost || lostLatest || useFutures && move.id === "gold" && old.name === "国际现货黄金" && old.value !== null) {
      movements[index] = { ...old, collectedAt: old.collectedAt || input.previous!.generatedAt };
      if (move.id === "gold") useFutures = old.name === "COMEX黄金连续期货";
    }
  }
  const originalNews = sameIssue?.news || [];
  const additional = selectNews(input.news.filter(item => {
    const time = Date.parse(item.publishedAt);
    return time >= window.start && time <= Date.parse(window.cutoff) && !originalNews.some(row => row.url === item.url);
  }));
  const news = [...originalNews, ...additional].slice(0, 6);
  const gaps = movements.filter(row => row.value === null || row.change === null || row.id === "domestic" && row.previousValue === undefined)
    .map(row => row.id === "fund" ? `${row.name}：${row.comparisonNote || "复盘日净值比较数据待补齐。"}`
      : `${row.name}未取得${window.reviewDate}的完整收盘与比较数据；可能休市或来源尚未更新，不以0代替。`);
  if (useFutures) gaps.push("国际现货黄金日线暂未取得，本期使用明确标注的COMEX连续期货作国际黄金观察；两者品种、结算方式不同。");
  if (!news.length) gaps.push("本期未采集到时段内可核对的相关新闻，暂不作具体事件归因。");
  input.sources.filter(row => row.status === "unavailable").forEach(row => gaps.push(`${BRIEF_SOURCES.find(source => source.id === row.id)?.name || row.id}未成功采集，本期不代表完整新闻覆盖。`));
  const goldNews = news.filter(row => row.topics.includes("gold") || row.topics.includes("rates")), equityNews = news.filter(row => row.topics.includes("equity"));
  const gold = movements[1], dollar = movements[3];
  const relationship = gold.change !== null && dollar.change !== null
    ? `国际黄金${signedChange(gold.change)}，美元指数${signedChange(dollar.change)}。` : "黄金与美元的完整日线对照尚待补齐。";
  const analysis: BriefAnalysis[] = [
    { title: "利率、美元怎样传导到黄金", text: `${relationship}${goldNews.length ? "本期报道提供了黄金或货币政策线索。" : "本期缺少足以确认具体驱动的报道。"}较高利率会增加持有无息黄金的机会成本，美元走强可能给美元计价金价带来压力；这是一种传导机制，尚不能证明或量化它们对昨日涨跌的贡献。`, references: goldNews.map(row => row.url).slice(0, 3) },
    { title: "国内克价为何可能不同步", text: `Au99.99以人民币/克计价，国际黄金参考价以美元/盎司计价，两个收盘时点也不同。${useFutures ? "本期国际参考使用期货日线，还包含期货市场因素，不能当作现货报价。" : ""}汇率、境内供需和价差都可能造成偏离；当前缺少同一时点的完整证据，不把两地收盘差直接称为套利或溢价变化。交易所现货价也不同于金店零售价、积存金买卖报价。`, references: [] },
    { title: "纳指变化怎样影响你的基金", text: `${movements[2].change !== null ? `纳指100当日${signedChange(movements[2].change)}。` : "纳指100该日收盘数据待补齐。"}${equityNews.length ? "本期科技或企业新闻可以作为核对线索；个股报道不能直接证明整个指数的原因。" : "本期缺少足以说明指数驱动的企业新闻。"}QDII还受汇率、费率和净值日期影响，不会与指数涨跌完全一致。`, references: equityNews.map(row => row.url).slice(0, 2) },
  ];
  const observed = movements.filter(row => row.change !== null).map(row => `${row.name}${signedChange(row.change!)}`);
  return { date: window.date, reviewDate: window.reviewDate, cutoff: window.cutoff, generatedAt: sameIssue?.generatedAt || observedAt,
    ...(sameIssue ? { updatedAt: observedAt } : {}),
    status: gaps.length ? "partial" : "ready", overview: observed.length ? `${window.reviewDate}收盘复盘：${observed.join("；")}。` : `${window.reviewDate}的收盘数据暂未齐备，先保留可核对的新闻与数据缺口。`, movements, news, analysis, gaps, sources: input.sources };
}
function short(value: unknown, max: number): value is string { return typeof value === "string" && value.length <= max; }
export function readBriefArchive(value: unknown, now: number): BriefArchive | null {
  if (!value || typeof value !== "object" || (value as BriefArchive).version !== 1 || !Array.isArray((value as BriefArchive).editions)) return null;
  const editions = (value as BriefArchive).editions.slice(0, 10).filter(row => {
    if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date)) || new Date(row.date).toISOString().slice(0, 10) !== row.date || row.date > morningWindow(now).date) return false;
    if (row.reviewDate !== shiftDay(row.date, -1) || Date.parse(row.cutoff) !== Date.parse(`${row.date}T09:00:00+08:00`)
      || !Number.isFinite(Date.parse(row.generatedAt)) || Date.parse(row.generatedAt) < Date.parse(row.cutoff) || Date.parse(row.generatedAt) > now + 60000) return false;
    if (row.updatedAt !== undefined && (!Number.isFinite(Date.parse(row.updatedAt)) || Date.parse(row.updatedAt) < Date.parse(row.generatedAt) || Date.parse(row.updatedAt) > now + 60000)) return false;
    if (!short(row.overview, 1200) || !["ready", "partial"].includes(row.status) || !Array.isArray(row.movements) || ![4, 5].includes(row.movements.length)) return false;
    const required = ["domestic", "gold", "nasdaq", "dxy", ...(row.movements.length === 5 ? ["fund"] : [])];
    if (!required.every(id => row.movements.some(m => m?.id === id))) return false;
    if (!row.movements.every(m => m && short(m.name, 100) && short(m.unit, 40) && short(m.source, 100)
      && (m.value === null || typeof m.value === "number" && Number.isFinite(m.value) && m.value > 0)
      && (m.change === null || typeof m.change === "number" && Number.isFinite(m.change) && Math.abs(m.change) <= 100)
      && (m.value === null ? m.date === null && m.change === null : m.date === row.reviewDate)
      && (m.comparisonNote === undefined || short(m.comparisonNote, 300))
      && (m.previousDate === undefined && m.previousValue === undefined || isCalendarDay(m.previousDate) && m.previousDate < row.reviewDate
        && typeof m.previousValue === "number" && Number.isFinite(m.previousValue) && m.previousValue > 0 && m.value !== null && m.change !== null
        && Math.abs((m.value / m.previousValue - 1) * 100 - m.change) < 0.011)
      && (m.latestAvailable === undefined || m.id === "fund" && m.value === null && isCalendarDay(m.latestAvailable?.date)
        && m.latestAvailable.date < row.reviewDate && typeof m.latestAvailable.value === "number" && Number.isFinite(m.latestAvailable.value) && m.latestAvailable.value > 0)
      && (m.collectedAt === undefined || Number.isFinite(Date.parse(m.collectedAt)) && Date.parse(m.collectedAt) <= now + 60000)
      && (m.supplementedAt === undefined || m.id === "fund" && m.value !== null && m.supplementedAt === m.collectedAt
        && Date.parse(m.supplementedAt) >= Date.parse(row.cutoff))
      && (m.id === "fund" ? (m.url === FUND_DISCLOSURE_URL || m.url === EASTMONEY_FUND_URL) && m.unit === "元/份"
        : m.id === "domestic" ? trustedUrl(m.url, "www.sge.com.cn") && m.unit === "元/克" : trustedUrl(m.url, "quote.eastmoney.com")))) return false;
    if (!Array.isArray(row.news) || row.news.length > 6 || !row.news.every(n => {
      const source = BRIEF_SOURCES.find(s => s.id === n.sourceId), time = Date.parse(n.publishedAt);
      return source && short(n.title, 260) && short(n.note, 800) && trustedUrl(n.url, source.host) && Number.isFinite(time)
        && time >= Date.parse(`${row.reviewDate}T00:00:00+08:00`) && time <= Date.parse(row.cutoff)
        && Array.isArray(n.topics) && n.topics.every(t => ["gold", "rates", "equity", "fx"].includes(t))
        && n.period === (time < Date.parse(`${row.date}T00:00:00+08:00`) ? "previous-day" : "overnight");
    })) return false;
    return Array.isArray(row.analysis) && row.analysis.length <= 5 && row.analysis.every(a => short(a.title, 150) && short(a.text, 2000)
      && Array.isArray(a.references) && a.references.every(url => row.news.some(n => n.url === url)))
      && Array.isArray(row.gaps) && row.gaps.length <= 12 && row.gaps.every(gap => short(gap, 1000))
      && Array.isArray(row.sources) && row.sources.every(source => BRIEF_SOURCES.some(s => s.id === source.id) && ["fetched", "unavailable"].includes(source.status)
        && (source.checkedAt === null || Number.isFinite(Date.parse(source.checkedAt)) && Date.parse(source.checkedAt) <= now + 60000)
        && Number.isInteger(source.count) && source.count >= 0 && source.count <= 10000);
  });
  return { version: 1, editions: editions.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7) };
}
export function mergeBriefArchives(archives: (BriefArchive | null)[]): BriefArchive {
  const days = new Map<string, MorningEdition>();
  for (const archive of archives) for (const edition of archive?.editions || []) {
    const old = days.get(edition.date);
    if (!old) { days.set(edition.date, edition); continue; }
    const newer = Date.parse(edition.generatedAt) > Date.parse(old.generatedAt) ||
      edition.generatedAt === old.generatedAt && Date.parse(edition.updatedAt || edition.generatedAt) > Date.parse(old.updatedAt || old.generatedAt);
    const [latest, other] = newer ? [edition, old] : [old, edition];
    const current = latest.movements.find(m => m.id === "fund"), candidate = other.movements.find(m => m.id === "fund");
    // An issue can retain its headline and generation time while its NAV is supplemented days later.
    const restore = candidate && candidate.value !== null && (!current || current.value === null ||
      Date.parse(candidate.collectedAt || other.generatedAt) > Date.parse(current.collectedAt || latest.generatedAt) ||
      candidate.value === current.value && candidate.previousValue !== undefined && current.comparisonNote === MISSING_NAV_COMPARISON);
    days.set(edition.date, restore ? withFundMovement(latest, candidate) : latest);
  }
  return { version: 1, editions: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7) };
}

function withFundMovement(edition: MorningEdition, move: BriefMovement): MorningEdition {
  const movements = [...edition.movements.filter(m => m.id !== "fund"), move];
  const gaps = edition.gaps.filter(text => !text.startsWith(move.name + "："));
  if (move.comparisonNote) gaps.push(move.name + "：" + move.comparisonNote);
  return { ...edition, movements, gaps, status: gaps.length ? "partial" : "ready" };
}

export function supplementPastNavs(archive: BriefArchive, navs: NavObservation[], now: number, provider?: NavProvider): BriefArchive {
  if (!navs.length) return archive;
  const current = morningWindow(now).date, stamp = new Date(now).toISOString();
  const editions = archive.editions.map(edition => {
    if (edition.date >= current) return edition;
    const old = edition.movements.find(m => m.id === "fund");
    if (old?.previousValue !== undefined) return edition;
    const move = fundMovement(navs, edition.reviewDate, provider);
    if (move.value === null || old?.value === move.value && move.previousValue === undefined) return edition;
    move.collectedAt = stamp; move.supplementedAt = stamp;
    // Leave all original news, narrative, cutoff and issue generation timestamps intact.
    return { ...withFundMovement(edition, move), updatedAt: stamp };
  });
  return { version: 1, editions };
}
