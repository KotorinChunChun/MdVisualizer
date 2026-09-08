import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARKDOWN_STYLE_SETTINGS,
  generateMarkdownStyleCss,
  normalizeMarkdownStyleSettings,
  scopeMarkdownStyleCss,
  validateMarkdownStyleCss,
} from "./markdownStyle";

describe("markdown style", () => {
  it("normalizes migrated and invalid settings", () => {
    expect(normalizeMarkdownStyleSettings({ breakMode: "soft-break", color: "#ABCDEF", fontSize: 200, fontFamily: "serif", lineHeight: 0 })).toEqual({
      breakMode: "soft-break", useThemeColor: true, color: "#abcdef", fontSize: 72, fontFamily: "serif", lineHeight: 1,
    });
    expect(normalizeMarkdownStyleSettings(null)).toEqual(DEFAULT_MARKDOWN_STYLE_SETTINGS);
  });

  it("generates deterministic CSS for CommonMark and visible soft breaks", () => {
    const common = generateMarkdownStyleCss(DEFAULT_MARKDOWN_STYLE_SETTINGS);
    expect(common).toContain("white-space: normal");
    expect(common).toContain("font-size: 16px");
    expect(common).toContain("color: var(--text-primary)");
    expect(generateMarkdownStyleCss({ ...DEFAULT_MARKDOWN_STYLE_SETTINGS, breakMode: "soft-break" })).toContain("white-space: pre-line");
  });

  it("scopes balanced external CSS and rejects escape or network directives", () => {
    expect(scopeMarkdownStyleCss(":scope h1 { color: red; }")).toContain("@scope (.markdown-body)");
    expect(validateMarkdownStyleCss(":scope { color: red; }} body {")).toContain("波括弧");
    expect(validateMarkdownStyleCss("@import url(https://example.com/x.css);")).toContain("外部読込");
    expect(scopeMarkdownStyleCss(":scope { content: '}'; /* } */ }")).not.toBeNull();
  });
});
