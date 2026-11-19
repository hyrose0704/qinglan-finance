import { test } from "node:test";
import assert from "node:assert/strict";
import { searchKnowledge } from "../lib/knowledge-search.ts";
import { parsePolicyFeed, readPolicySnapshot } from "../lib/policy.ts";

const now = Date.parse("2026-11-19T12:00:00Z");

test("a question about QDII currency links to the relevant lesson", () => {
  assert.equal(searchKnowledge("QDII汇率怎么算？")[0].lessonId, "qdii");
});

test("a reserve question finds the financial buffer explanation", () => {
  assert.equal(searchKnowledge("应急金应该留多少？")[0].lessonId, "reserve");
});

test("a loss recovery question finds the risk lesson", () => {
  assert.equal(searchKnowledge("亏损后要涨多少才能回本？")[0].lessonId, "risk");
});

test("unrelated questions do not produce fabricated course explanations", () => {
  assert.deepEqual(searchKnowledge("火星探测器软件架构"), []);
});

test("empty questions have no search results", () => {
  assert.deepEqual(searchKnowledge(" "), []);
});

test("official RSS parsing preserves the original release time", () => {
  const item = parsePolicyFeed(`<rss><channel><item><title>Policy release</title>
    <link><![CDATA[https://www.federalreserve.gov/newsevents/example.htm]]></link>
    <pubDate><![CDATA[Wed, 18 Nov 2026 19:00:00 GMT]]></pubDate></item></channel></rss>`, "www.federalreserve.gov", now);
  assert.equal(item.publishedAt, "2026-11-18T19:00:00.000Z");
});

test("a future official release is excluded rather than labeled current", () => {
  const item = parsePolicyFeed(`<rss><channel><item><title>Future release</title>
    <link>https://www.federalreserve.gov/newsevents/example.htm</link>
    <pubDate>Fri, 20 Nov 2026 19:00:00 GMT</pubDate></item></channel></rss>`, "www.federalreserve.gov", now);
  assert.equal(item, null);
});

test("a lookalike host in an RSS link is rejected", () => {
  const item = parsePolicyFeed(`<rss><channel><item><title>Untrusted link</title>
    <link>https://www.federalreserve.gov.example.com/example.htm</link>
    <pubDate>Wed, 18 Nov 2026 19:00:00 GMT</pubDate></item></channel></rss>`, "www.federalreserve.gov", now);
  assert.equal(item, null);
});

test("an undated feed item cannot be presented as a dated release", () => {
  assert.equal(parsePolicyFeed("<item><title>Undated</title><link>https://www.bls.gov/example.htm</link></item>", "www.bls.gov", now), null);
});

test("cached policy data keeps its successful collection timestamp", () => {
  const snapshot = readPolicySnapshot({ generatedAt: "2026-11-19T12:00:00Z", sources: [{
    id: "fed", checkedAt: "2026-11-18T20:00:00Z", status: "cached",
    item: { title: "Policy release", url: "https://www.federalreserve.gov/newsevents/example.htm", publishedAt: "2026-11-18T19:00:00Z" },
  }] }, now);
  assert.equal(snapshot.sources[0].status, "cached");
  assert.equal(snapshot.sources[0].checkedAt, "2026-11-18T20:00:00.000Z");
});

test("a missing CPI source is displayed as unavailable", () => {
  const snapshot = readPolicySnapshot({ generatedAt: "2026-11-19T12:00:00Z", sources: [] }, now);
  assert.deepEqual(snapshot.sources[1], { id: "cpi", checkedAt: null, status: "unavailable", item: null });
});
