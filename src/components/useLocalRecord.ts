import { useState } from "react";

export function useLocalRecord<T>(key: string, initial: T, parse: (value: unknown) => T) {
  const [error, setError] = useState("");
  const [record, setRecord] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? parse(JSON.parse(raw)) : initial;
    } catch { return initial; }
  });
  function save(next: T) {
    const valid = parse(next);
    setRecord(valid);
    try {
      localStorage.setItem(key, JSON.stringify(valid));
      setError("");
    } catch { setError("本次结果有效，但浏览器未能保存。关闭页面后可能丢失本次进度。"); }
  }
  return { record, save, error };
}
