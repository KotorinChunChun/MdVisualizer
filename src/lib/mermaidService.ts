import { mergeMermaidFrontmatter } from "./mergeMermaidFrontmatter";

let initialized = false;

export async function renderMermaid(source: string, id: string, theme: string): Promise<string> {
  const mermaid = (await import("mermaid")).default;
  if (!initialized) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    initialized = true;
  }
  const result = await mermaid.render(id, mergeMermaidFrontmatter(source, theme));
  return result.svg;
}
