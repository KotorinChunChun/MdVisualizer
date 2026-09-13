export const DEFAULT_CODE_BLOCK_FOLD_MIN_LINES = 10;

export function normalizeCodeBlockFoldMinLines(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(100000, Math.trunc(value)))
    : DEFAULT_CODE_BLOCK_FOLD_MIN_LINES;
}
