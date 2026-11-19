import { readFileSync, writeFileSync } from "node:fs";
import { POLICY_SOURCES, parsePolicyFeed, readPolicySnapshot } from "../lib/policy.ts";

const now = Date.now();
let previous = null;
try { previous = readPolicySnapshot(JSON.parse(readFileSync("public/policy.json", "utf8")), now); } catch {}
try {
  const response = await fetch("https://hyrose0704.github.io/qinglan-finance/policy.json", { signal: AbortSignal.timeout(7000) });
  if (response.ok) {
    const published = readPolicySnapshot(await response.json(), now);
    if (published) previous = { generatedAt: published.generatedAt, sources: POLICY_SOURCES.map(spec => {
      const local = previous?.sources.find(source => source.id === spec.id);
      const remote = published.sources.find(source => source.id === spec.id);
      return Date.parse(remote?.checkedAt || "") > Date.parse(local?.checkedAt || "1970-01-01") ? remote : local || remote;
    }).filter(Boolean) };
  }
} catch {}

const results = await Promise.allSettled(POLICY_SOURCES.map(async spec => {
  const response = await fetch(spec.feedUrl, {
    headers: { "User-Agent": "QinglanFinance/1.0 (public RSS reader)", Accept: "application/rss+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  const item = parsePolicyFeed(await response.text(), spec.host, now);
  if (!item) throw Error("No dated official release found");
  return { id: spec.id, status: "fetched", checkedAt: new Date(now).toISOString(), item };
}));
const sources = POLICY_SOURCES.map((spec, index) => {
  const result = results[index];
  if (result.status === "fulfilled") return result.value;
  const old = previous?.sources.find(source => source.id === spec.id);
  console.warn(`${spec.id}: collection unavailable; retaining dated data if available.`);
  return { id: spec.id, status: old?.item ? "cached" : "unavailable", checkedAt: old?.checkedAt || null, item: old?.item || null };
});
writeFileSync("public/policy.json", JSON.stringify({ generatedAt: new Date(now).toISOString(), sources }));
console.log(`Official releases: ${sources.filter(source => source.status === "fetched").length} sources collected.`);
