import type { CodeFenceOccurrence, ImageMarkdownOccurrence } from "./markdownOccurrences";
import { normalizedAssetFilename } from "./assetConversion";

export type MermaidStorageConversionContext =
  | { documentPath: string; storage: "embedded"; occurrence: CodeFenceOccurrence; source: string; relativePath?: string; alt?: string }
  | { documentPath: string; storage: "external"; occurrence: ImageMarkdownOccurrence; source: string; alt?: string };

function markdownDestination(source: string): string {
  return /[\s()]/.test(source) ? `<${source}>` : source;
}

export function mermaidExternalReference(source: string, caption = ""): string {
  return `![${caption.trim()}](${markdownDestination(source)})`;
}

export function mermaidEmbeddedFence(source: string, lineEnding: "\n" | "\r\n" | "\r" = "\n"): string {
  const normalized = source.trim().replace(/\r\n|\r|\n/g, lineEnding);
  const longestBacktickRun = Math.max(0, ...Array.from(normalized.matchAll(/`+/g), (match) => match[0].length));
  const marker = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return `${marker}mermaid${lineEnding}${normalized}${lineEnding}${marker}`;
}

export function preferredMermaidFilename(occurrence: CodeFenceOccurrence): string {
  const title = /(?:^|\s)(?:title|caption)=(?:"([^"]+)"|'([^']+)'|([^\s]+))/i.exec(occurrence.meta);
  const label = (title?.[1] ?? title?.[2] ?? title?.[3] ?? "diagram").replace(/\.(?:mmd|mermaid)$/i, "");
  return normalizedAssetFilename(label, "mmd", "diagram");
}
