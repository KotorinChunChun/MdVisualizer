// @ts-nocheck -- the application deliberately does not ship Node typings;
// Vitest still runs this test in Node and can read the source styles.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appCss = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");
const themesCss = readFileSync(join(process.cwd(), "src/styles/themes.css"), "utf8");

function ruleBody(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

describe("theme content palette", () => {
  it.each(["light", "github", "solarized", "nord", "dark"])(
    "defines paired foreground and background colors for %s",
    (theme) => {
      const block = ruleBody(themesCss, `:root[data-theme="${theme}"]`);
      expect(block).toContain("--inline-code-bg:");
      expect(block).toContain("--inline-code-color:");
      expect(block).toContain("--table-header-bg:");
      expect(block).toContain("--table-header-color:");
    },
  );

  it("keeps print layout independent from the selected dark theme", () => {
    const printBlock = ruleBody(appCss, ".view-print");
    expect(printBlock).toContain("--inline-code-bg:");
    expect(printBlock).toContain("--inline-code-color:");
    expect(printBlock).toContain("--table-header-bg:");
    expect(printBlock).toContain("--table-header-color:");
  });

  it("uses paired foreground variables on rendered content", () => {
    expect(ruleBody(appCss, ".markdown-body code")).toContain("color: var(--inline-code-color)");
    expect(ruleBody(appCss, ".markdown-body th")).toContain("color: var(--table-header-color)");
  });
});
