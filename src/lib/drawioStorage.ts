import type { CodeFenceOccurrence, ImageMarkdownOccurrence } from "./markdownOccurrences";
import { normalizedAssetFilename } from "./assetConversion";

export type DrawioStorageConversionContext =
  | {
    documentPath: string;
    storage: "embedded";
    occurrence: CodeFenceOccurrence;
    source: string;
  }
  | {
    documentPath: string;
    storage: "external";
    occurrence: ImageMarkdownOccurrence;
    source: string;
  };

function markdownDestination(source: string): string {
  return /[\s()]/.test(source) ? `<${source}>` : source;
}

export function drawioExternalReference(source: string, caption = "draw.io"): string {
  return `![${caption.trim() || "draw.io"}](${markdownDestination(source)})`;
}

export function drawioEmbeddedFence(source: string, lineEnding: "\n" | "\r\n" | "\r" = "\n"): string {
  const normalized = source.trim().replace(/\r\n|\r|\n/g, lineEnding);
  const longestBacktickRun = Math.max(0, ...Array.from(normalized.matchAll(/`+/g), (match) => match[0].length));
  const marker = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return `${marker}drawio${lineEnding}${normalized}${lineEnding}${marker}`;
}

export function markdownLineEnding(markdown: string): "\n" | "\r\n" | "\r" {
  const match = /\r\n|\r|\n/.exec(markdown);
  return (match?.[0] as "\n" | "\r\n" | "\r" | undefined) ?? "\n";
}

export function preferredDrawioFilename(occurrence: CodeFenceOccurrence): string {
  const title = /(?:^|\s)(?:title|caption)=(?:"([^"]+)"|'([^']+)'|([^\s]+))/i.exec(occurrence.meta);
  const label = (title?.[1] ?? title?.[2] ?? title?.[3] ?? "diagram").replace(/\.drawio$/i, "");
  return normalizedAssetFilename(label, "drawio", "diagram");
}
