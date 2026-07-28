import { type RefObject, useEffect, useMemo, useState } from "react";

export interface SearchState {
  query: string;
  setQuery: (query: string) => void;
  regex: boolean;
  setRegex: (regex: boolean) => void;
  caseSensitive: boolean;
  setCaseSensitive: (caseSensitive: boolean) => void;
  resultCount: number;
  activeIndex: number;
  next: () => void;
  previous: () => void;
  error: string | null;
  clear: () => void;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeOwnedMarks(root: HTMLElement) {
  root.querySelectorAll("mark[data-markdown-search]").forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
  });
  root.normalize();
}

export function useSearch(rootRef: RefObject<HTMLElement | null>): SearchState {
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [resultCount, setResultCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const pattern = useMemo(() => query ? (regex ? query : escapeRegex(query)) : "", [query, regex]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    removeOwnedMarks(root);
    if (!pattern) { setResultCount(0); setActiveIndex(-1); setError(null); return; }

    let expression: RegExp;
    try {
      expression = new RegExp(pattern, `g${caseSensitive ? "" : "i"}`);
      setError(null);
    } catch (reason) {
      setResultCount(0);
      setActiveIndex(-1);
      setError(`正規表現エラー: ${String(reason)}`);
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest("mark[data-markdown-search]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);

    let count = 0;
    for (const node of nodes) {
      const text = node.data;
      expression.lastIndex = 0;
      const matches = [...text.matchAll(expression)].filter((match) => match[0].length > 0);
      if (!matches.length) continue;
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const match of matches) {
        const start = match.index ?? 0;
        fragment.append(text.slice(cursor, start));
        const mark = document.createElement("mark");
        mark.dataset.markdownSearch = "true";
        mark.textContent = match[0];
        fragment.append(mark);
        cursor = start + match[0].length;
        count += 1;
      }
      fragment.append(text.slice(cursor));
      node.replaceWith(fragment);
    }
    setResultCount(count);
    setActiveIndex(count ? 0 : -1);
    return () => removeOwnedMarks(root);
  }, [rootRef, pattern, caseSensitive]);

  useEffect(() => {
    const marks = rootRef.current?.querySelectorAll<HTMLElement>("mark[data-markdown-search]") ?? [];
    marks.forEach((mark, index) => mark.dataset.active = index === activeIndex ? "true" : "false");
    if (activeIndex >= 0 && typeof marks[activeIndex]?.scrollIntoView === "function") {
      marks[activeIndex].scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [rootRef, activeIndex, resultCount]);

  const move = (delta: number) => {
    if (!resultCount) return;
    setActiveIndex((current) => (current + delta + resultCount) % resultCount);
  };

  return { query, setQuery, regex, setRegex, caseSensitive, setCaseSensitive, resultCount, activeIndex, next: () => move(1), previous: () => move(-1), error, clear: () => setQuery("") };
}
