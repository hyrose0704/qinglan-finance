import { useState } from "react";
import { Search } from "lucide-react";
import { searchKnowledge } from "@/lib/knowledge-search";

const QUESTIONS = ["应急金应该留多少？", "QDII汇率怎么算？", "亏损后要涨多少才能回本？", "基金费用怎么看？"];

export function KnowledgeSearch({ learn }: { learn: (topic: string) => void }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const results = searchKnowledge(query);
  function search(value: string) { setInput(value); setQuery(value.trim()); }
  return <section className="panel knowledge-search">
    <div className="panel-heading"><h2><Search size={20} />带着问题找知识</h2><span className="badge green">本地检索 · 已启用</span></div>
    <p>输入想了解的概念，查找8节课程中的解释与延伸阅读。问题在当前浏览器处理，不发送资金资料。</p>
    <form className="knowledge-search-form" onSubmit={e => { e.preventDefault(); search(input); }}>
      <label className="visually-hidden" htmlFor="knowledge-query">搜索金融知识</label>
      <input id="knowledge-query" type="search" value={input} maxLength={160}
        placeholder="例如：QDII汇率怎么算？" onChange={e => setInput(e.target.value)} />
      <button className="button primary" type="submit" disabled={input.trim().length < 2}>查找解释</button>
    </form>
    <div className="question-suggestions">{QUESTIONS.map(question => <button key={question} onClick={() => search(question)}>{question}</button>)}</div>
    {query && <div className="knowledge-results" aria-live="polite">
      <p>{results.length ? `找到 ${results.length} 条相关基础知识` : "课程里暂未找到相关解释。可以换用“应急金、汇率、费用、回本”等概念词。"}</p>
      {results.map(result => <article key={result.lessonId}><h3>{result.heading}</h3><p>{result.text}</p>
        <div><button className="text-button" onClick={() => learn(result.lessonId)}>学习：{result.lessonTitle}</button>
          <a href={result.source.url} target="_blank" rel="noreferrer">延伸阅读</a></div>
      </article>)}
    </div>}
    <small>这是课程内容检索，不是生成式AI回答；不联网搜索，也不预测今天的涨跌。</small>
  </section>;
}
