export const PRINT_FONT_FAMILIES = ["system", "serif", "sans-serif", "monospace"] as const;
export type PrintFontFamily = typeof PRINT_FONT_FAMILIES[number];

export interface PrintStyleSettings {
  headingColor: string;
  borderColor: string;
  backgroundColor: string;
  fontFamily: PrintFontFamily;
  monochrome: boolean;
}

export const DEFAULT_PRINT_STYLE_SETTINGS: PrintStyleSettings = {
  headingColor: "#1f2328",
  borderColor: "#d0d7de",
  backgroundColor: "#ffffff",
  fontFamily: "system",
  monochrome: false,
};

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
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
  };
}

export function applyPrintStyleSettings(root: HTMLElement, settings: PrintStyleSettings): void {
  root.style.setProperty("--print-heading-color", settings.headingColor);
  root.style.setProperty("--print-border-color", settings.borderColor);
  root.style.setProperty("--print-background-color", settings.backgroundColor);
  root.style.setProperty("--print-font-family", FONT_STACKS[settings.fontFamily]);
  root.dataset.printMonochrome = String(settings.monochrome);
}
