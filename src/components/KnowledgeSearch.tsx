import { useState } from "react";
import { Search } from "lucide-react";
import { searchKnowledge } from "@/lib/knowledge-search";

const QUESTIONS = ["应急金应该留多少？", "苹果毛利率", "DCF 终值", "指数集中度"];

export function KnowledgeSearch({ learn }: { learn: (topic: string) => void }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const results = searchKnowledge(query);
  function search(value: string) { setInput(value); setQuery(value.trim()); }
  return <section className="panel knowledge-search">
    <div className="panel-heading"><h2><Search size={20} />搜索课程与案例</h2></div>
    <form className="knowledge-search-form" onSubmit={e => { e.preventDefault(); search(input); }}>
      <label className="visually-hidden" htmlFor="knowledge-query">搜索金融知识</label>
      <input id="knowledge-query" type="search" value={input} maxLength={160}
        placeholder="例如：QDII汇率怎么算？" onChange={e => setInput(e.target.value)} />
      <button className="button primary" type="submit" disabled={input.trim().length < 2}>查找解释</button>
    </form>
    <div className="question-suggestions">{QUESTIONS.map(question => <button key={question} onClick={() => search(question)}>{question}</button>)}</div>
    {query && <div className="knowledge-results" aria-live="polite">
      <p>{results.length ? `相关课程 · ${results.length} 条` : "未找到匹配内容。试试“现金流”“毛利率”或“集中度”。"}</p>
      {results.map(result => <article key={result.lessonId}><h3>{result.heading}</h3><p>{result.text}</p>
        <div><button className="text-button" onClick={() => learn(result.lessonId)}>学习：{result.lessonTitle}</button>
          <a href={result.source.url} target="_blank" rel="noreferrer">延伸阅读</a></div>
      </article>)}
    </div>}
    <small>在当前浏览器检索本站课程原文。</small>
  </section>;
}
