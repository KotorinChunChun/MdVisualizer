import { normalizeAnchorText } from "./blockAnchors";

export interface SemanticScrollAnchor {
  blockId: string;
  foldId: string;
  text: string;
  sourceLine: number | null;
  viewportOffset: number;
  scrollRatio: number;
}

function visibleBlockElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-block-id]")]
    .filter((element) => element.getClientRects().length > 0 && !element.closest("[hidden]"));
}

export function captureScrollAnchor(
  container: HTMLElement,
  contentRoot: HTMLElement,
): SemanticScrollAnchor | null {
  const containerRect = container.getBoundingClientRect();
  const blocks = visibleBlockElements(contentRoot);
  const target = blocks.find((element) => element.getBoundingClientRect().bottom >= containerRect.top)
    ?? blocks[blocks.length - 1];
  if (!target?.dataset.blockId) return null;
  const maxScroll = Math.max(1, container.scrollHeight - container.clientHeight);
  return {
    blockId: target.dataset.blockId,
    foldId: target.dataset.blockFoldId ?? "",
    text: normalizeAnchorText(target.textContent ?? ""),
    sourceLine: target.dataset.sourceLine ? Number(target.dataset.sourceLine) : null,
    viewportOffset: target.getBoundingClientRect().top - containerRect.top,
    scrollRatio: container.scrollTop / maxScroll,
  };
}

function closestBySourceLine(elements: HTMLElement[], sourceLine: number) {
  return elements.reduce<HTMLElement | null>((nearest, element) => {
    const line = Number(element.dataset.sourceLine);
    if (!Number.isFinite(line) || line > sourceLine) return nearest;
    if (!nearest) return element;
    return line > Number(nearest.dataset.sourceLine) ? element : nearest;
  }, null);
}

export function restoreScrollAnchor(
  container: HTMLElement,
  contentRoot: HTMLElement,
  anchor: SemanticScrollAnchor,
): "block" | "fold" | "line" | "ratio" {
  const blocks = visibleBlockElements(contentRoot);
  let target = blocks.find((element) => element.dataset.blockId === anchor.blockId);
  if (!target && anchor.text) {
    target = blocks.find((element) =>
      element.dataset.blockFoldId === anchor.foldId
      && normalizeAnchorText(element.textContent ?? "") === anchor.text);
  }
  if (!target && anchor.text) {
    target = blocks.find((element) => normalizeAnchorText(element.textContent ?? "") === anchor.text);
  }
  if (target) {
    const delta = target.getBoundingClientRect().top
      - container.getBoundingClientRect().top
      - anchor.viewportOffset;
    container.scrollTop = Math.max(0, container.scrollTop + delta);
    return "block";
  }

  const fold = anchor.foldId
    ? [...contentRoot.querySelectorAll<HTMLElement>("[data-fold-id]")]
      .find((element) => element.dataset.foldId === anchor.foldId)
    : undefined;
  if (fold) {
    container.scrollTop = Math.max(
      0,
      container.scrollTop + fold.getBoundingClientRect().top - container.getBoundingClientRect().top,
    );
    return "fold";
  }

  if (anchor.sourceLine !== null) {
    target = closestBySourceLine(blocks, anchor.sourceLine) ?? undefined;
    if (target) {
      container.scrollTop = Math.max(
        0,
        container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top,
      );
      return "line";
    }
  }

  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  container.scrollTop = maxScroll * anchor.scrollRatio;
  return "ratio";
}
