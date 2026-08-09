export const SYNTAX_HIGHLIGHT_THEMES = ["adaptive", "github-light", "github-dark", "monokai", "solarized"] as const;
export type SyntaxHighlightTheme = typeof SYNTAX_HIGHLIGHT_THEMES[number];

export interface SyntaxHighlightSettings {
  theme: SyntaxHighlightTheme;
  customColors: boolean;
  background: string;
  foreground: string;
}

export const DEFAULT_SYNTAX_HIGHLIGHT_SETTINGS: SyntaxHighlightSettings = {
  theme: "adaptive",
  customColors: false,
  background: "#1a1c23",
  foreground: "#eceff4",
};

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function normalizeSyntaxHighlightSettings(value: unknown): SyntaxHighlightSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_SYNTAX_HIGHLIGHT_SETTINGS };
  const candidate = value as Partial<SyntaxHighlightSettings>;
  return {
    theme: SYNTAX_HIGHLIGHT_THEMES.includes(candidate.theme as SyntaxHighlightTheme)
      ? candidate.theme as SyntaxHighlightTheme
      : DEFAULT_SYNTAX_HIGHLIGHT_SETTINGS.theme,
    customColors: candidate.customColors === true,
    background: typeof candidate.background === "string" && COLOR_PATTERN.test(candidate.background)
      ? candidate.background.toLowerCase()
      : DEFAULT_SYNTAX_HIGHLIGHT_SETTINGS.background,
    foreground: typeof candidate.foreground === "string" && COLOR_PATTERN.test(candidate.foreground)
      ? candidate.foreground.toLowerCase()
      : DEFAULT_SYNTAX_HIGHLIGHT_SETTINGS.foreground,
  };
}

export function applySyntaxHighlightSettings(root: HTMLElement, settings: SyntaxHighlightSettings): void {
  root.dataset.syntaxTheme = settings.theme;
  if (settings.customColors) {
    root.style.setProperty("--code-block-bg", settings.background);
    root.style.setProperty("--code-block-color", settings.foreground);
  } else {
    root.style.removeProperty("--code-block-bg");
    root.style.removeProperty("--code-block-color");
  }
}
