export interface SourcePosition {
  line: number;
  column?: number;
}

export interface SourceAnchor {
  source: SourcePosition;
  headingId?: string;
  foldIds: string[];
  blockId?: string;
  presentationPageId?: string;
  matchStart?: number;
  matchEnd?: number;
}

export interface PresentationSourcePage {
  id: string;
  sourceLine: number;
}

export function presentationPageIdForSourceLine(pages: readonly PresentationSourcePage[], line: number): string | null {
  let current: string | null = null;
  for (const page of pages) {
    if (page.sourceLine > line) break;
    current = page.id;
  }
  return current ?? pages[0]?.id ?? null;
}

export function normalizeSourceLines(content: string): string[] {
  return content.replace(/\r\n?/g, "\n").split("\n");
}

/** Resolves the heading section containing a source line. */
export function headingIdForSourceLine(
  headings: readonly { id: string; line: number }[],
  line: number,
): string | null {
  let current: string | null = null;
  for (const heading of headings) {
    if (heading.line > line) break;
    current = heading.id;
  }
  return current;
}

/** Chooses the rendered block at or immediately before a source line. */
export function nearestRenderedSourceBlock<T extends { line: number }>(
  blocks: readonly T[],
  line: number,
): T | null {
  let current: T | null = null;
  for (const block of blocks) {
    if (!Number.isFinite(block.line) || block.line > line) break;
    current = block;
  }
  return current ?? blocks[0] ?? null;
}

export function foldIdsForElement(element: Element | null): string[] {
  const ids: string[] = [];
  for (let current = element?.closest<HTMLElement>("[data-fold-id]") ?? null; current; current = current.parentElement?.closest<HTMLElement>("[data-fold-id]") ?? null) {
    const id = current.dataset.foldId;
    if (id) ids.push(id);
  }
  return ids;
}

export function sourceAnchorForElement(element: Element | null): SourceAnchor | null {
  if (!(element instanceof HTMLElement)) return null;
  const line = Number(element.dataset.sourceLine);
  if (!Number.isFinite(line) || line < 1) return null;
  return {
    source: { line },
    headingId: foldIdsForElement(element)[0],
    foldIds: foldIdsForElement(element),
    blockId: element.dataset.blockId,
  };
}

export function sourceLineAtTextOffset(content: string, offset: number): SourcePosition {
  const bounded = Math.max(0, Math.min(content.length, offset));
  const prefix = content.slice(0, bounded);
  const line = (prefix.match(/\r\n|\r|\n/g) ?? []).length + 1;
  const lastBreak = Math.max(prefix.lastIndexOf("\n"), prefix.lastIndexOf("\r"));
  return { line, column: bounded - lastBreak };
}
