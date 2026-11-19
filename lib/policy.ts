export const POLICY_SOURCES = [
  { id: "fed", name: "美联储 · 货币政策", feedUrl: "https://www.federalreserve.gov/feeds/press_monetary.xml",
    homeUrl: "https://www.federalreserve.gov/feeds/feeds.htm", host: "www.federalreserve.gov",
    context: "用于核对利率决议、政策措辞和发布时间。公告本身不能证明当日金价或股价变化的原因。" },
  { id: "cpi", name: "美国劳工统计局 · CPI", feedUrl: "https://www.bls.gov/feed/cpi.rss",
    homeUrl: "https://www.bls.gov/feed/", host: "www.bls.gov",
    context: "用于查阅通胀原始发布。网站尚未解析CPI数值、市场预期和实际利率，不自动判断超预期或政策方向。" },
] as const;

export interface PolicyItem {
  title: string;
  url: string;
  publishedAt: string;
}
export interface PolicySource {
  id: string;
  checkedAt: string | null;
  status: "fetched" | "cached" | "unavailable";
  item: PolicyItem | null;
}
export interface PolicySnapshot {
  generatedAt: string;
  sources: PolicySource[];
}

function plain(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

function tag(item: string, name: string): string {
  return plain(item.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "");
}

function trustedUrl(value: string, host: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === host && !url.username && !url.password && !url.port;
  } catch { return false; }
}

export function parsePolicyFeed(xml: string, host: string, now: number): PolicyItem | null {
  if (xml.length > 500000 || !Number.isFinite(now)) return null;
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].flatMap(match => {
    const raw = match[1], title = tag(raw, "title"), url = tag(raw, "link");
    const time = Date.parse(tag(raw, "pubDate"));
    if (!title || !trustedUrl(url, host) || !Number.isFinite(time) || time > now + 60000) return [];
    const words = title.split(" ");
    const displayTitle = words.length > 20 ? words.slice(0, 20).join(" ") + "…" : title.slice(0, 250);
    return [{ title: displayTitle, url, publishedAt: new Date(time).toISOString() }];
  });
  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0] || null;
}

export function readPolicySnapshot(value: unknown, now: number): PolicySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PolicySnapshot>;
  if (!Array.isArray(raw.sources) || !raw.generatedAt || !Number.isFinite(Date.parse(raw.generatedAt))) return null;
  const sources: PolicySource[] = POLICY_SOURCES.map(spec => {
    const source = raw.sources!.find(row => row && row.id === spec.id);
    const time = Date.parse(source?.checkedAt || "");
    const checkedAt = Number.isFinite(time) && time <= now + 60000 ? new Date(time).toISOString() : null;
    const item = source?.item;
    const itemTime = Date.parse(item?.publishedAt || "");
    const valid = item && typeof item.title === "string" && item.title.length <= 260
      && typeof item.url === "string" && trustedUrl(item.url, spec.host)
      && Number.isFinite(itemTime) && itemTime <= now + 60000;
    return { id: spec.id, checkedAt,
      status: valid && checkedAt ? source?.status === "fetched" ? "fetched" : "cached" : "unavailable",
      item: valid && checkedAt ? { title: item.title, url: item.url, publishedAt: new Date(itemTime).toISOString() } : null };
  });
  return { generatedAt: raw.generatedAt, sources };
}
