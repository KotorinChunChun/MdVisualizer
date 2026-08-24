export interface SourceBlockMetric {
  line: number;
  top: number;
}

export interface EditorCursorPosition {
  line: number;
  screenY: number;
}

/** Resolves the source block displayed at the top of the View pane. */
export function sourceLineAtViewportTop(blocks: readonly SourceBlockMetric[], viewportTop: number): number {
  if (blocks.length === 0) return 1;
  let nearest = blocks[0];
  for (const block of blocks) {
    if (block.top > viewportTop + 1) break;
    nearest = block;
  }
  return Math.max(1, nearest.line);
}

/** Finds the closest source block at or before a requested Edit-pane line. */
export function sourceBlockIndexForLine(lines: readonly number[], requestedLine: number): number {
  if (lines.length === 0) return -1;
  let nearest = 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] > requestedLine) break;
    nearest = index;
  }
  return nearest;
}

/** Estimates the rendered Y coordinate for a source line between adjacent block anchors. */
export function sourceTopForLine(blocks: readonly SourceBlockMetric[], requestedLine: number): number | null {
  if (blocks.length === 0) return null;
  if (requestedLine <= blocks[0].line) return blocks[0].top;
  for (let index = 1; index < blocks.length; index += 1) {
    const previous = blocks[index - 1];
    const next = blocks[index];
    if (requestedLine === next.line) return next.top;
    if (requestedLine < next.line) {
      const ratio = (requestedLine - previous.line) / (next.line - previous.line);
      return previous.top + ((next.top - previous.top) * ratio);
    }
  }
  return blocks[blocks.length - 1].top;
}

/** Converts a screen-pixel anchor difference to the preview's scroll units. */
export function scrollDeltaForViewportAnchor(targetTop: number, viewportTop: number, desiredViewportY: number, viewportScale = 1): number {
  const scale = Number.isFinite(viewportScale) && viewportScale > 0 ? viewportScale : 1;
  return (targetTop - viewportTop - desiredViewportY) / scale;
}
