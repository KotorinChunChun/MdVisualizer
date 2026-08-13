export interface MarkdownHeadingBlock {
  start: number;
  lineEnd: number;
  sectionEnd: number;
  level: number;
  parentStart: number | null;
  numbered: boolean;
  numberToken: string | null;
  separator: string;
  title: string;
}

interface SourceLine { text: string; ending: string; start: number }

function sourceLines(source: string): SourceLine[] {
  const result: SourceLine[] = [];
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  let start = 0;
  while (start < source.length || (start === 0 && source.length === 0)) {
    pattern.lastIndex = start;
    const match = pattern.exec(source);
    if (!match) break;
    result.push({ text: match[1], ending: match[2], start });
    start = pattern.lastIndex;
    if (!match[2] || start >= source.length) break;
  }
  return result;
}

export function parseMarkdownHeadingBlocks(source: string): MarkdownHeadingBlock[] {
  const headings: MarkdownHeadingBlock[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;
  for (const line of sourceLines(source)) {
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line.text)?.[1];
    const closing = fence && new RegExp(`^ {0,3}${fence.marker === "`" ? "`" : "~"}{${fence.length},}\\s*$`).test(line.text);
    if (!fence) {
      const match = /^( {0,3})(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/.exec(line.text);
      if (match && !opening) {
        const numbered = /^(\d+(?:\.\d+)*)([.)]?)\s+(.+)$/.exec(match[3]);
        headings.push({
          start: line.start,
          lineEnd: line.start + line.text.length,
          sectionEnd: source.length,
          level: match[2].length,
          parentStart: null,
          numbered: Boolean(numbered),
          numberToken: numbered?.[1] ?? null,
          separator: numbered?.[2] || ".",
          title: numbered?.[3] ?? match[3],
        });
      }
    }
    if (closing) fence = null;
    else if (!fence && opening) fence = { marker: opening[0] as "`" | "~", length: opening.length };
  }

  const stack: MarkdownHeadingBlock[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
    heading.parentStart = stack[stack.length - 1]?.start ?? null;
    heading.sectionEnd = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level)?.start ?? source.length;
    stack.push(heading);
  }
  return headings;
}

export function normalizeNumberedHeadings(source: string): string {
  const headings = parseMarkdownHeadingBlocks(source);
  const counts = new Map<string, number>();
  const replacements: Array<{ from: number; to: number; value: string }> = [];
  for (const heading of headings) {
    if (!heading.numbered || !heading.numberToken) continue;
    const key = `${heading.parentStart ?? "root"}:${heading.level}`;
    const number = (counts.get(key) ?? 0) + 1;
    counts.set(key, number);
    const tokenStart = source.indexOf(heading.numberToken, heading.start);
    replacements.push({ from: tokenStart, to: tokenStart + heading.numberToken.length, value: String(number) });
  }
  let result = source;
  for (const replacement of replacements.reverse()) {
    result = result.slice(0, replacement.from) + replacement.value + result.slice(replacement.to);
  }
  return result;
}

export function moveHeadingBlock(
  source: string,
  sourceHeadingStart: number,
  targetHeadingStart: number,
  position: "before" | "after",
): string | null {
  const headings = parseMarkdownHeadingBlocks(source);
  const moving = headings.find((heading) => heading.start === sourceHeadingStart);
  const target = headings.find((heading) => heading.start === targetHeadingStart);
  if (!moving || !target || moving === target
    || moving.level !== target.level
    || moving.parentStart !== target.parentStart) return null;

  const block = source.slice(moving.start, moving.sectionEnd);
  const without = source.slice(0, moving.start) + source.slice(moving.sectionEnd);
  let destination = position === "before" ? target.start : target.sectionEnd;
  if (destination > moving.start) destination -= block.length;
  const moved = without.slice(0, destination) + block + without.slice(destination);
  return normalizeNumberedHeadings(moved);
}
