export const PRINT_FONT_FAMILIES = ["system", "serif", "sans-serif", "monospace"] as const;
export type PrintFontFamily = typeof PRINT_FONT_FAMILIES[number];
export const PRINT_FOLD_MODES = ["all", "current"] as const;
export type PrintFoldMode = typeof PRINT_FOLD_MODES[number];

export interface PrintStyleSettings {
  headingColor: string;
  borderColor: string;
  backgroundColor: string;
  fontFamily: PrintFontFamily;
  monochrome: boolean;
  foldMode: PrintFoldMode;
  showTitle: boolean;
  showFilename: boolean;
  showDate: boolean;
  showPageNumbers: boolean;
}

export const DEFAULT_PRINT_STYLE_SETTINGS: PrintStyleSettings = {
  headingColor: "#1f2328",
  borderColor: "#d0d7de",
  backgroundColor: "#ffffff",
  fontFamily: "system",
  monochrome: false,
  foldMode: "all",
  showTitle: true,
  showFilename: true,
  showDate: true,
  showPageNumbers: true,
};

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const PRINT_STYLE_KEYS = [
  "headingColor",
  "borderColor",
  "backgroundColor",
  "fontFamily",
  "monochrome",
  "foldMode",
  "showTitle",
  "showFilename",
  "showDate",
  "showPageNumbers",
] as const;
const FONT_STACKS: Record<PrintFontFamily, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Yu Mincho", "Hiragino Mincho ProN", serif',
  "sans-serif": 'Arial, "Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif',
  monospace: 'Consolas, "BIZ UDゴシック", "Liberation Mono", monospace',
};

export function normalizePrintStyleSettings(value: unknown): PrintStyleSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_PRINT_STYLE_SETTINGS };
  const candidate = value as Partial<PrintStyleSettings>;
  const color = (input: unknown, fallback: string) => typeof input === "string" && COLOR_PATTERN.test(input) ? input.toLowerCase() : fallback;
  return {
    headingColor: color(candidate.headingColor, DEFAULT_PRINT_STYLE_SETTINGS.headingColor),
    borderColor: color(candidate.borderColor, DEFAULT_PRINT_STYLE_SETTINGS.borderColor),
    backgroundColor: color(candidate.backgroundColor, DEFAULT_PRINT_STYLE_SETTINGS.backgroundColor),
    fontFamily: PRINT_FONT_FAMILIES.includes(candidate.fontFamily as PrintFontFamily) ? candidate.fontFamily as PrintFontFamily : DEFAULT_PRINT_STYLE_SETTINGS.fontFamily,
    monochrome: candidate.monochrome === true,
    foldMode: candidate.foldMode === "current" ? "current" : "all",
    showTitle: candidate.showTitle !== false,
    showFilename: candidate.showFilename !== false,
    showDate: candidate.showDate !== false,
    showPageNumbers: candidate.showPageNumbers !== false,
  };
}

/**
 * Returns true when a saved value still uses the pre-metadata print schema or
 * contains a value that will be changed by normalization. Keeping this check
 * separate from normalization lets the settings hook migrate old values once
 * without making the renderer depend on persistence.
 */
export function needsPrintStyleSettingsMigration(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== PRINT_STYLE_KEYS.length || PRINT_STYLE_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(candidate, key))) return true;
  const normalized = normalizePrintStyleSettings(candidate);
  return PRINT_STYLE_KEYS.some((key) => candidate[key] !== normalized[key]);
}

export function applyPrintStyleSettings(root: HTMLElement, settings: PrintStyleSettings): void {
  const normalized = normalizePrintStyleSettings(settings);
  root.style.setProperty("--print-heading-color", normalized.headingColor);
  root.style.setProperty("--print-border-color", normalized.borderColor);
  root.style.setProperty("--print-background-color", normalized.backgroundColor);
  root.style.setProperty("--print-font-family", FONT_STACKS[normalized.fontFamily]);
  root.dataset.printMonochrome = String(normalized.monochrome);
}
