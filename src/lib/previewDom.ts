
export function focusAndSelectSearchInput(input: HTMLInputElement | null): void {
  input?.focus();
  input?.select();
}

export function documentLinkTarget(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const link = target.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement) || !link.closest(".markdown-body")) return null;
  return link.getAttribute("href");
}

export function tocHeadingIdAtPointer(target: Element | null, markdownRoot: HTMLElement | null): string | null {
  if (!target || !markdownRoot || !markdownRoot.contains(target)) return null;
  return target.closest<HTMLElement>("[data-fold-id]")?.dataset.foldId ?? null;
}

export function previewSourceBlocks(root: HTMLElement | null, visibleOnly = false): HTMLElement[] {
  const seen = new Set<number>();
  return [...(root?.querySelectorAll<HTMLElement>("[data-source-line]") ?? [])].filter((block) => {
    const line = Number(block.dataset.sourceLine);
    if (!Number.isFinite(line) || line < 1 || seen.has(line)) return false;
    if (visibleOnly && block.getClientRects().length === 0) return false;
    seen.add(line);
    return true;
  });
}

export function previewSourceLineAtNode(node: Node | null, root: HTMLElement): number | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const block = element?.closest<HTMLElement>("[data-source-line]");
  if (!block || !root.contains(block)) return null;
  const line = Number(block.dataset.sourceLine);
  return Number.isFinite(line) && line >= 1 ? line : null;
}

export function previewSelectionSourceRange(selection: Selection | null, root: HTMLElement, sourceLines: readonly number[], fallbackLine: number): { inside: boolean; firstLine: number; lastLine: number } {
  const inside = Boolean(selection && !selection.isCollapsed && selection.anchorNode && selection.focusNode
    && root.contains(selection.anchorNode) && root.contains(selection.focusNode));
  const range = inside && selection!.rangeCount > 0 ? selection!.getRangeAt(0) : null;
  return {
    inside,
    firstLine: range ? previewSourceLineAtNode(range.startContainer, root) ?? sourceLines[0] ?? fallbackLine : fallbackLine,
    lastLine: range ? previewSourceLineAtNode(range.endContainer, root) ?? sourceLines[sourceLines.length - 1] ?? fallbackLine : fallbackLine,
  };
}

/** True while the browser owns a non-empty text selection inside View. */
export function hasPreviewTextSelection(selection: Selection | null, root: HTMLElement | null): boolean {
  return Boolean(root && selection && !selection.isCollapsed && selection.toString().length > 0
    && selection.anchorNode && selection.focusNode
    && root.contains(selection.anchorNode) && root.contains(selection.focusNode));
}

export function restoreDocumentSearchFocus(origin: HTMLElement | null, fallback: () => void): void {
  if (origin?.isConnected) {
    origin.focus({ preventScroll: true });
    if (document.activeElement === origin) return;
  }
  fallback();
}
