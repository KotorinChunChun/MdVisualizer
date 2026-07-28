import { mergeMermaidFrontmatter } from "./mergeMermaidFrontmatter";

let initialized = false;

export function mermaidThemeFor(appTheme: string): string {
  return ({ dark: "dark", light: "default", github: "default", solarized: "base", nord: "neutral", system: "default" } as Record<string, string>)[appTheme] ?? "default";
}

export async function renderMermaid(source: string, id: string, theme: string): Promise<string> {
  const mermaid = (await import("mermaid")).default;
  if (!initialized) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    initialized = true;
  }
  const result = await mermaid.render(id, mergeMermaidFrontmatter(source, mermaidThemeFor(theme)));
  return result.svg;
}
