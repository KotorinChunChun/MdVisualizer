export interface SourceBlockMetric {
  line: number;
  top: number;
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
