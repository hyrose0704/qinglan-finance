import { LESSONS } from "./curriculum.ts";

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const RELATED: Record<string, string[]> = {
  汇率: ["qdii", "人民币", "外币"],
  应急: ["应急金", "预留"],
  定投: ["每月", "投入", "费用"],
  回本: ["亏损", "剩余", "下跌"],
  分配: ["配置", "用款", "目标"],
  贷款: ["还款", "现金流"],
};

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
  const ranked = LESSONS.map(lesson => {
    const title = normalize(lesson.title);
    const sections = lesson.sections.map(section => {
      const heading = normalize(section.title), body = normalize(section.text);
      const score = [...terms].reduce((sum, term) => sum + (title.includes(term) ? 5 : 0)
        + (heading.includes(term) ? 3 : 0) + (body.includes(term) ? 1 : 0), 0);
      return { ...section, score };
    }).sort((a, b) => b.score - a.score);
    return { lessonId: lesson.id, lessonTitle: lesson.title, source: lesson.source,
      heading: sections[0].title, text: sections[0].text, score: sections[0].score };
  });
  return ranked.filter(result => result.score >= 3).sort((a, b) => b.score - a.score).slice(0, 3);
}
