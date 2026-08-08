import type { SearchState } from "../hooks/useSearch";

interface SearchBarProps { search: SearchState; inputRef: React.RefObject<HTMLInputElement | null>; onClose: () => void; }

export function SearchBar({ search, inputRef, onClose }: SearchBarProps) {
  return (
    <div className="search-bar-wrap">
    <div className="search-bar" role="search">
      <input ref={inputRef} value={search.query} onChange={(event) => search.setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.shiftKey ? search.previous() : search.next(); } }} placeholder="Search document" aria-label="文書を検索" />
      <label><input type="checkbox" checked={search.caseSensitive} onChange={(event) => search.setCaseSensitive(event.target.checked)} />Aa</label>
      <label><input type="checkbox" checked={search.regex} onChange={(event) => search.setRegex(event.target.checked)} />.*</label>
      <label>文脈 <select aria-label="文脈行数" value={search.contextLines} onChange={(event) => search.setContextLines(Number(event.target.value))}>{[0, 1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <button type="button" onClick={search.previous} disabled={!search.resultCount} aria-label="前の検索結果">↑</button>
      <button type="button" onClick={search.next} disabled={!search.resultCount} aria-label="次の検索結果">↓</button>
      <span aria-live="polite">{search.error ?? `${search.resultCount ? `${search.activeIndex + 1}/${search.resultCount}` : "0 matches"}`}</span>
      <button type="button" onClick={onClose} aria-label="検索を閉じる">×</button>
    </div>
    </div>
  );
}
