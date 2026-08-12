import { nextHeadingId } from "./headingIds";

export interface SearchResult {
  index: number;
  line: number;
  column: number;
  headingId?: string;
  headingPath: string[];
  match: string;
  before: string[];
  text: string;
  after: string[];
}

export interface SearchResultSet {
  results: SearchResult[];
  truncated: boolean;
  error: string | null;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Finds source-level matches so the results panel remains useful even when a
 * match is currently hidden by a folded section. */
export function findSearchResults(
  content: string,
  query: string,
  { regex = false, caseSensitive = false, contextLines = 2, limit = 500 }: { regex?: boolean; caseSensitive?: boolean; contextLines?: number; limit?: number } = {},
): SearchResultSet {
  if (!query) return { results: [], truncated: false, error: null };
  let expression: RegExp;
  try {
    expression = new RegExp(regex ? query : escapeRegex(query), `g${caseSensitive ? "" : "i"}`);
  } catch (reason) {
    return { results: [], truncated: false, error: `正規表現エラー: ${String(reason)}` };
  }
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const counts = new Map<string, number>();
  const headings: { id: string; level: number; title: string }[] = [];
  const results: SearchResult[] = [];
  let truncated = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      headings.splice(level - 1);
      headings.push({ id: nextHeadingId(counts, heading[2]), level, title: heading[2] });
    }
    expression.lastIndex = 0;
    for (const match of line.matchAll(expression)) {
      if (!match[0]) continue;
      if (results.length === limit) { truncated = true; break; }
      const current = headings[headings.length - 1];
      results.push({
        index: results.length,
        line: lineIndex + 1,
        column: (match.index ?? 0) + 1,
        headingId: current?.id,
        headingPath: headings.map((item) => item.title),
        match: match[0],
        before: lines.slice(Math.max(0, lineIndex - contextLines), lineIndex),
        text: line,
        after: lines.slice(lineIndex + 1, lineIndex + 1 + contextLines),
      });
    }
    if (truncated) break;
  }
  return { results, truncated, error: null };
}
