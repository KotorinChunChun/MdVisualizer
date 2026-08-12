export const VIEW_MODES = ["auto", "a4-portrait", "a3-portrait", "presentation", "images"] as const;

export type ViewMode = typeof VIEW_MODES[number];
export type DocumentLayout = Extract<ViewMode, "auto" | "a4-portrait" | "a3-portrait">;

const LEGACY_VIEW_MODES: Record<string, ViewMode> = {
  standard: "auto",
  compact: "a4-portrait",
  print: "a4-portrait",
  wide: "a3-portrait",
};

export function normalizeViewMode(value: unknown): ViewMode {
  if (typeof value !== "string") return "auto";
  if ((VIEW_MODES as readonly string[]).includes(value)) return value as ViewMode;
  return LEGACY_VIEW_MODES[value] ?? "auto";
}

/** Keeps only valid, full-path keyed per-document view modes. */
export function normalizeDocumentViewModes(value: unknown): Record<string, ViewMode> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([path, mode]) => path.trim().length > 0 && typeof mode === "string" && ((VIEW_MODES as readonly string[]).includes(mode) || mode in LEGACY_VIEW_MODES))
    .map(([path, mode]) => [path, normalizeViewMode(mode)])
  );
}

export function isDocumentLayout(value: ViewMode): value is DocumentLayout {
  return value === "auto" || value === "a4-portrait" || value === "a3-portrait";
}
