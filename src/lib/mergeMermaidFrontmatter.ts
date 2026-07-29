const MERMAID_THEMES = new Set(["default", "dark", "base", "neutral"]);

/**
 * Builds an isolated Mermaid input without mutating the user's Markdown.
 *
 * Mermaid accepts configuration from both YAML frontmatter and `%%{…}%%`
 * directives.  Filtering known-dangerous keys is not sufficient because new
 * Mermaid options can also alter the SVG/HTML sanitisation path.  Therefore
 * neither user-controlled configuration channel is forwarded at all.  The
 * only generated configuration is the application-selected theme.
 */
export function mergeMermaidFrontmatter(source: string, theme: string): string {
  // Directives may span multiple lines. Remove every standalone directive,
  // rather than trying to parse or selectively retain its config object.
  const withoutDirectives = source.replace(/^[\t ]*%%\{[\s\S]*?\}%%[\t ]*(?:\r?\n|$)/gm, "");

  // Drop only a complete leading YAML document. The diagram body remains
  // byte-for-byte intact, including malformed frontmatter-like text.
  const frontmatter = withoutDirectives.match(/^---[\t ]*\r?\n[\s\S]*?\r?\n---[\t ]*(?:\r?\n|$)/);
  const body = frontmatter ? withoutDirectives.slice(frontmatter[0].length) : withoutDirectives;
  const safeTheme = MERMAID_THEMES.has(theme) ? theme : "default";

  return `---\nconfig:\n  theme: ${safeTheme}\n---\n${body}`;
}
