import type { SearchState } from "../hooks/useSearch";

interface SearchBarProps { search: SearchState; inputRef: React.RefObject<HTMLInputElement | null>; }

export function SearchBar({ search, inputRef }: SearchBarProps) {
  return (
    <div className="search-bar" role="search">
      <input ref={inputRef} value={search.query} onChange={(event) => search.setQuery(event.target.value)} placeholder="Search document" aria-label="文書を検索" />
      <label><input type="checkbox" checked={search.caseSensitive} onChange={(event) => search.setCaseSensitive(event.target.checked)} />Aa</label>
      <label><input type="checkbox" checked={search.regex} onChange={(event) => search.setRegex(event.target.checked)} />.*</label>
      <button type="button" onClick={search.previous} disabled={!search.resultCount} aria-label="前の検索結果">↑</button>
      <button type="button" onClick={search.next} disabled={!search.resultCount} aria-label="次の検索結果">↓</button>
      <span aria-live="polite">{search.error ?? `${search.resultCount ? `${search.activeIndex + 1}/${search.resultCount}` : "0 matches"}`}</span>
      {search.query && <button type="button" onClick={search.clear} aria-label="検索を閉じる">×</button>}
    </div>
  );
}
