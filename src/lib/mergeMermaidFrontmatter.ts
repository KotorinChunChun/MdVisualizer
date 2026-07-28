import { parse, stringify } from "yaml";

const securedKeys = new Set(["securityLevel", "startOnLoad", "secure"]);

/** Builds a render-only Mermaid source without mutating the user's Markdown. */
export function mergeMermaidFrontmatter(source: string, theme: string): string {
  const withoutDirectives = source.replace(/^%%\{[\s\S]*?\}%%\s*(?:\r?\n)?/gm, "");
  const match = withoutDirectives.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  const body = match ? withoutDirectives.slice(match[0].length) : withoutDirectives;
  const parsed = match ? (parse(match[1]) as Record<string, unknown> ?? {}) : {};
  const config = typeof parsed.config === "object" && parsed.config !== null
    ? { ...(parsed.config as Record<string, unknown>) }
    : {};

  for (const key of securedKeys) delete config[key];
  config.theme = theme;
  return `---\n${stringify({ ...parsed, config }).trimEnd()}\n---\n${body}`;
}
