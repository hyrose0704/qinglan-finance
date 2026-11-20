import { LESSONS } from "./curriculum.ts";

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\bp\s*\/?\s*e\b/g, "市盈率")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const RELATED: Record<string, string[]> = {
  汇率: ["qdii", "人民币", "外币"],
  应急: ["应急金", "预留"],
  定投: ["每月", "投入", "费用"],
  回本: ["亏损", "剩余", "下跌"],
  分配: ["配置", "用款", "目标"],
  贷款: ["还款", "现金流"],
  市盈率: ["盈利倍数", "可比公司"],
  折现: ["dcf", "终值", "折现率"],
  自由现金流: ["资本开支", "经营现金流"],
  集中度: ["穿透", "成份", "权重"],
  超预期: ["预期", "指引"],
};

const CONCEPTS = ["应急金", "回本", "汇率", "毛利率", "市盈率", "集中度", "现金流", "自由现金流",
  "经营现金流", "终值", "折现", "超预期", "估值", "通胀", "购买力", "久期", "债券", "dcf", "eps", "fcff", "wacc"];
const COMMON_WORDS = new Set(["多少", "怎么", "什么", "如何", "应该", "才能"]);

export function searchKnowledge(input: string) {
  const query = normalize(input.slice(0, 160));
  if (query.length < 2) return [];
  const words = query.match(/[a-z0-9]{2,}|[\p{Script=Han}]{2,}/gu) || [];
  const terms = new Set<string>();
  for (const word of words) {
    if (/^[a-z0-9]+$/.test(word)) terms.add(word);
    else for (let i = 0; i < word.length - 1; i++) terms.add(word.slice(i, i + 2));
  }
  for (const [word, related] of Object.entries(RELATED)) {
    if (query.includes(word)) related.forEach(term => terms.add(term));
  }
  for (const term of COMMON_WORDS) terms.delete(term);
  const concepts = CONCEPTS.filter(term => query.includes(term));
  const specific = concepts.filter(term => !concepts.some(other => other !== term && other.includes(term)));
  const ranked = LESSONS.map(lesson => {
    const title = normalize(lesson.title);
    const passages = [...lesson.sections];
    if (lesson.track !== "basics") {
      const study = lesson.caseStudy;
      for (const [label, text] of [["条件", study.evidence], ["计算", study.calculation],
        ["解读", study.interpretation], ["复核", study.falsifier]]) {
        passages.push({ title: study.title + " · " + label, text });
      }
    }
    const sections = passages.map(section => {
      const heading = normalize(section.title), body = normalize(section.text);
      const exact = (title.includes(query) ? 10 : 0) + (heading.includes(query) ? 6 : 0) + (body.includes(query) ? 3 : 0);
      const conceptScore = specific.reduce((sum, term) => sum + (title.includes(term) ? 8 : 0)
        + (heading.includes(term) ? 5 : 0) + (body.includes(term) ? 4 : 0), 0);
      const score = [...terms].reduce((sum, term) => sum + (title.includes(term) ? 5 : 0)
        + (heading.includes(term) ? 3 : 0) + (body.includes(term) ? 1 : 0), exact + conceptScore);
      return { ...section, score };
    }).sort((a, b) => b.score - a.score);
    return { lessonId: lesson.id, lessonTitle: lesson.title, source: lesson.source,
      heading: sections[0].title, text: sections[0].text, score: sections[0].score };
  });
  ranked.sort((a, b) => b.score - a.score);
  const cutoff = Math.max(3, ranked[0].score * 0.25);
  return ranked.filter(result => result.score >= cutoff).slice(0, 3);
}
