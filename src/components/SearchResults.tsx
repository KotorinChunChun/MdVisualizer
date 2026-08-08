import type { SearchResult } from "../lib/searchResults";

export function SearchResults({
  results,
  activeIndex,
  truncated,
  onSelect,
  onActivate,
}: {
  results: SearchResult[];
  activeIndex: number;
  truncated: boolean;
  onSelect: (index: number) => void;
  onActivate: (result: SearchResult) => void;
}) {
  if (!results.length) return null;
  const move = (current: number, delta: number) => {
    const index = (current + delta + results.length) % results.length;
    onSelect(index);
  };
  return <section className="search-results" aria-label="検索結果">
    {truncated && <p className="search-results__notice" role="status">先頭500件のみ表示しています。</p>}
    <ol role="listbox" aria-label="検索結果一覧" onKeyDown={(event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); move(Math.max(activeIndex, 0), 1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); move(Math.max(activeIndex, 0), -1); }
      else if (event.key === "Enter" && activeIndex >= 0) { event.preventDefault(); onActivate(results[activeIndex]); }
    }}>
      {results.map((result) => <li key={`${result.line}:${result.column}:${result.index}`}>
        <button type="button" role="option" aria-selected={result.index === activeIndex} onFocus={() => onSelect(result.index)} onClick={() => onActivate(result)}>
          <span className="search-results__meta">{result.line}行目 · {result.headingPath.join(" › ") || "本文"}</span>
          {result.before.map((line, index) => <span className="search-results__context" key={`before-${index}`}>{line}</span>)}
          <strong>{result.text}</strong>
          {result.after.map((line, index) => <span className="search-results__context" key={`after-${index}`}>{line}</span>)}
        </button>
      </li>)}
    </ol>
  </section>;
}
