export type MarkdownBreakMode = "commonmark" | "soft-break";
export type MarkdownFontFamily = "system" | "serif" | "sans-serif" | "monospace";

export interface MarkdownStyleSettings {
  breakMode: MarkdownBreakMode;
  useThemeColor: boolean;
  color: string;
  fontSize: number;
  fontFamily: MarkdownFontFamily;
  lineHeight: number;
}

export const MARKDOWN_FONT_FAMILIES: readonly MarkdownFontFamily[] = ["system", "serif", "sans-serif", "monospace"];

export const DEFAULT_MARKDOWN_STYLE_SETTINGS: MarkdownStyleSettings = {
  breakMode: "commonmark",
  useThemeColor: true,
  color: "#d4d4d4",
  fontSize: 16,
  fontFamily: "system",
  lineHeight: 1.65,
};

const FONT_STACKS: Record<MarkdownFontFamily, string> = {
  system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Yu Mincho', 'Hiragino Mincho ProN', serif",
  "sans-serif": "Arial, 'Yu Gothic UI', 'Hiragino Kaku Gothic ProN', sans-serif",
  monospace: "'Cascadia Code', Consolas, 'Noto Sans Mono', monospace",
};

const finiteRange = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
};

export function normalizeMarkdownStyleSettings(value: unknown): MarkdownStyleSettings {
  const candidate = value && typeof value === "object" ? value as Partial<MarkdownStyleSettings> : {};
  return {
    breakMode: candidate.breakMode === "soft-break" ? "soft-break" : "commonmark",
    useThemeColor: candidate.useThemeColor !== false,
    color: typeof candidate.color === "string" && /^#[0-9a-f]{6}$/i.test(candidate.color) ? candidate.color.toLowerCase() : DEFAULT_MARKDOWN_STYLE_SETTINGS.color,
    fontSize: finiteRange(candidate.fontSize, DEFAULT_MARKDOWN_STYLE_SETTINGS.fontSize, 8, 72),
    fontFamily: MARKDOWN_FONT_FAMILIES.includes(candidate.fontFamily as MarkdownFontFamily) ? candidate.fontFamily as MarkdownFontFamily : "system",
    lineHeight: finiteRange(candidate.lineHeight, DEFAULT_MARKDOWN_STYLE_SETTINGS.lineHeight, 1, 3),
  };
}

export function generateMarkdownStyleCss(value: MarkdownStyleSettings): string {
  const settings = normalizeMarkdownStyleSettings(value);
  return `/* MdVisualizerで生成したMarkdown本文用CSS */
:scope {
  color: ${settings.useThemeColor ? "var(--text-primary)" : settings.color};
  font-size: ${settings.fontSize}px;
  font-family: ${FONT_STACKS[settings.fontFamily]};
  line-height: ${settings.lineHeight};
}

:scope p,
:scope li {
  white-space: ${settings.breakMode === "soft-break" ? "pre-line" : "normal"};
}
`;
}

/** Validate enough structure to prevent an external file from escaping @scope. */
export function validateMarkdownStyleCss(css: string): string | null {
  if (/@(import|namespace|document)\b/i.test(css)) return "外部読込を行うCSS命令は使用できません。";
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let comment = false;
  for (let index = 0; index < css.length; index += 1) {
    const current = css[index];
    const next = css[index + 1];
    if (comment) {
      if (current === "*" && next === "/") { comment = false; index += 1; }
      continue;
    }
    if (!quote && current === "/" && next === "*") { comment = true; index += 1; continue; }
    if (quote) {
      if (current === "\\") { index += 1; continue; }
      if (current === quote) quote = null;
      continue;
    }
    if (current === "'" || current === '"') { quote = current; continue; }
    if (current === "{") depth += 1;
    if (current === "}") {
      depth -= 1;
      if (depth < 0) return "CSSの波括弧が対応していません。";
    }
  }
  if (comment || quote || depth !== 0) return "CSSのコメント、引用符、または波括弧が閉じられていません。";
  return null;
}

export function scopeMarkdownStyleCss(css: string, scopeSelector = ".markdown-body"): string | null {
  return validateMarkdownStyleCss(css) ? null : `@scope (${scopeSelector}) {\n${css}\n}`;
}
