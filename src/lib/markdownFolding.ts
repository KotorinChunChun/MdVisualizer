export interface FoldRange {
  from: number;
  to: number;
}

export interface MarkdownEditorViewState {
  content: string;
  scrollTop: number;
  scrollLeft: number;
  anchor: number;
  head: number;
  folds: FoldRange[];
}

const rememberedViewStates = new Map<string, MarkdownEditorViewState>();
const MAX_REMEMBERED_VIEW_STATES = 64;

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/** The smallest single replacement that transforms previous into next. */
export function minimalTextChange(previous: string, next: string): TextChange | null {
  if (previous === next) return null;
  let from = 0;
  while (from < previous.length && from < next.length && previous[from] === next[from]) from += 1;
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (previousEnd > from && nextEnd > from && previous[previousEnd - 1] === next[nextEnd - 1]) { previousEnd -= 1; nextEnd -= 1; }
  return { from, to: previousEnd, insert: next.slice(from, nextEnd) };
}

export function mapTextPosition(position: number, change: TextChange): number {
  if (position <= change.from) return position;
  if (position >= change.to) return position + change.insert.length - (change.to - change.from);
  return change.from + Math.min(position - change.from, change.insert.length);
}

/** Preserve folds that are wholly outside a replacement; unfold affected folds safely. */
export function mapFoldRanges(ranges: FoldRange[], change: TextChange | null): FoldRange[] {
  if (!change) return ranges.map((range) => ({ ...range }));
  return ranges
    .filter((range) => range.to <= change.from || range.from >= change.to)
    .map((range) => ({ from: mapTextPosition(range.from, change), to: mapTextPosition(range.to, change) }));
}

export function rememberMarkdownEditorViewState(key: string, state: MarkdownEditorViewState): void {
  rememberedViewStates.delete(key);
  rememberedViewStates.set(key, { ...state, folds: state.folds.map((range) => ({ ...range })) });
  while (rememberedViewStates.size > MAX_REMEMBERED_VIEW_STATES) rememberedViewStates.delete(rememberedViewStates.keys().next().value!);
}

export function restoreMarkdownEditorViewState(key: string, content: string): MarkdownEditorViewState | null {
  const state = rememberedViewStates.get(key);
  if (!state) return null;
  const change = minimalTextChange(state.content, content);
  const position = (value: number) => Math.max(0, Math.min(content.length, change ? mapTextPosition(value, change) : value));
  const folds = mapFoldRanges(state.folds, change).filter((range) => range.from >= 0 && range.from < range.to && range.to <= content.length);
  return {
    content,
    scrollTop: Math.max(0, state.scrollTop),
    scrollLeft: Math.max(0, state.scrollLeft),
    anchor: position(state.anchor),
    head: position(state.head),
    folds,
  };
}

/** Returns the foldable inner ranges of fenced code blocks with enough body lines. */
export function longFencedCodeBlockRanges(source: string, minimumBodyLines: number): FoldRange[] {
  const minimum = Math.max(1, Math.floor(minimumBodyLines));
  const lines = source.split("\n");
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  const ranges: FoldRange[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = /^[ \t]{0,3}(`{3,}|~{3,})[^`~]*$/.exec(lines[index]);
    if (!opening) continue;
    const marker = opening[1];
    const close = new RegExp(`^[ \\t]{0,3}${marker[0]}{${marker.length},}[ \\t]*$`);
    let closing = index + 1;
    while (closing < lines.length && !close.test(lines[closing])) closing += 1;
    if (closing >= lines.length) continue;
    if (closing - index - 1 >= minimum) ranges.push({ from: offsets[index] + lines[index].length, to: offsets[closing] });
    index = closing;
  }
  return ranges;
}
