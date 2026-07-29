import { type RefObject, useEffect, useMemo, useRef, useState } from "react";

export interface SearchState {
  query: string;
  setQuery: (query: string) => void;
  regex: boolean;
  setRegex: (regex: boolean) => void;
  caseSensitive: boolean;
  setCaseSensitive: (caseSensitive: boolean) => void;
  resultCount: number;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
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

export function useSearch(
  rootRef: RefObject<HTMLElement | null>,
  scopeId = "main",
  onMatchedFoldIds?: (ids: string[]) => void,
  refreshKey = "",
): SearchState {
  const onMatchedFoldIdsRef = useRef(onMatchedFoldIds);
  useEffect(() => { onMatchedFoldIdsRef.current = onMatchedFoldIds; }, [onMatchedFoldIds]);
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [resultCount, setResultCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const nativeRangesRef = useRef<Range[]>([]);
  const nativeHighlightsRef = useRef<Map<string, unknown> | undefined>(undefined);
  const nativeHighlightNamesRef = useRef<{ all: string; active: string } | null>(null);
  const pattern = useMemo(() => query ? (regex ? query : escapeRegex(query)) : "", [query, regex]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    removeOwnedMarks(root);
    if (!pattern) { setResultCount(0); setActiveIndex(-1); setError(null); onMatchedFoldIdsRef.current?.([]); return; }

    let expression: RegExp;
    try {
      expression = new RegExp(pattern, `g${caseSensitive ? "" : "i"}`);
      setError(null);
    } catch (reason) {
      setResultCount(0);
      setActiveIndex(-1);
      setError(`正規表現エラー: ${String(reason)}`);
      onMatchedFoldIdsRef.current?.([]);
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest("mark[data-markdown-search]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);

    const nativeHighlights = (globalThis.CSS as (typeof CSS & { highlights?: Map<string, unknown> }) | undefined)?.highlights;
    const HighlightConstructor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const highlightBase = `markdown-search-${scopeId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const highlightNames = { all: highlightBase, active: `${highlightBase}-active` };
    const ranges: Range[] = [];
    const matchedFoldIds = new Set<string>();
    const collectFoldIds = (element: Element | null) => {
      let current = element?.closest<HTMLElement>(".fold-section") ?? null;
      while (current) {
        if (current.dataset.foldId) matchedFoldIds.add(current.dataset.foldId);
        current = current.parentElement?.closest<HTMLElement>(".fold-section") ?? null;
      }
    };

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
        if (nativeHighlights && HighlightConstructor) {
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + match[0].length);
          ranges.push(range);
          collectFoldIds(node.parentElement);
          count += 1;
          continue;
        }
        fragment.append(text.slice(cursor, start));
        const mark = document.createElement("mark");
        mark.dataset.markdownSearch = "true";
        mark.textContent = match[0];
        fragment.append(mark);
        collectFoldIds(node.parentElement);
        cursor = start + match[0].length;
        count += 1;
      }
      if (!(nativeHighlights && HighlightConstructor)) {
        fragment.append(text.slice(cursor));
        node.replaceWith(fragment);
      }
    }
    let highlightStyle: HTMLStyleElement | null = null;
    if (nativeHighlights && HighlightConstructor) {
      nativeRangesRef.current = ranges;
      nativeHighlightsRef.current = nativeHighlights;
      nativeHighlightNamesRef.current = highlightNames;
      nativeHighlights.set(highlightNames.all, new HighlightConstructor(...ranges));
      highlightStyle = document.createElement("style");
      highlightStyle.dataset.markdownSearchStyle = highlightNames.all;
      highlightStyle.textContent = `::highlight(${highlightNames.all}) { background: #fbbf24; color: #111827; } ::highlight(${highlightNames.active}) { background: #f97316; color: #111827; }`;
      document.head.append(highlightStyle);
    }
    setResultCount(count);
    setActiveIndex((current) => count ? Math.min(Math.max(current, 0), count - 1) : -1);
    onMatchedFoldIdsRef.current?.([...matchedFoldIds]);
    return () => {
      removeOwnedMarks(root);
      nativeHighlights?.delete(highlightNames.all);
      nativeHighlights?.delete(highlightNames.active);
      nativeRangesRef.current = [];
      nativeHighlightNamesRef.current = null;
      highlightStyle?.remove();
    };
  }, [rootRef, pattern, caseSensitive, scopeId, refreshKey]);

  useEffect(() => {
    const marks = rootRef.current?.querySelectorAll<HTMLElement>("mark[data-markdown-search]") ?? [];
    marks.forEach((mark, index) => mark.dataset.active = index === activeIndex ? "true" : "false");
    if (activeIndex >= 0 && typeof marks[activeIndex]?.scrollIntoView === "function") {
      marks[activeIndex].scrollIntoView({ block: "center", behavior: "auto" });
    }
    const highlights = nativeHighlightsRef.current;
    const names = nativeHighlightNamesRef.current;
    const HighlightConstructor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const range = nativeRangesRef.current[activeIndex];
    if (highlights && names && HighlightConstructor) {
      if (range) highlights.set(names.active, new HighlightConstructor(range));
      else highlights.delete(names.active);
      const target = range?.startContainer.parentElement;
      if (target instanceof HTMLElement && typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "center", behavior: "auto" });
    }
  }, [rootRef, activeIndex, resultCount, refreshKey]);

  const move = (delta: number) => {
    if (!resultCount) return;
    setActiveIndex((current) => (current + delta + resultCount) % resultCount);
  };

  return { query, setQuery, regex, setRegex, caseSensitive, setCaseSensitive, resultCount, activeIndex, setActiveIndex, next: () => move(1), previous: () => move(-1), error, clear: () => setQuery("") };
}
