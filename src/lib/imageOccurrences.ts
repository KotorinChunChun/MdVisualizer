import { unified } from "unified";
import remarkParse from "remark-parse";
import { getFileName, resolveLocalImagePath } from "./path";
import { localPathIdentity } from "./pathIdentity";
import { remarkObsidianImages } from "./remarkObsidianImages";

type Position = {
  start?: { line?: number; offset?: number };
};

type MarkdownNode = {
  type?: string;
  url?: string;
  alt?: string | null;
  value?: string;
  position?: Position;
  children?: MarkdownNode[];
};

export interface ImageOccurrence {
  id: string;
  source: string;
  localPath: string | null;
  caption: string;
  sourceLine: number;
  sourceOffset: number;
}

export interface ImageOccurrenceGroup {
  path: string;
  source: string;
  filename: string;
  occurrences: ImageOccurrence[];
}

const parser = unified().use(remarkParse).use(remarkObsidianImages);
const htmlImagePattern = /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
const htmlAltPattern = /\balt\s*=\s*(["'])(.*?)\1/i;

export function imageOccurrenceId(sourceOffset: number): string {
  return `markdown-image-${Math.max(0, sourceOffset)}`;
}

export function collectImageOccurrences(markdown: string, baseDir: string): ImageOccurrence[] {
  const root = parser.runSync(parser.parse(markdown)) as MarkdownNode;
  const occurrences: ImageOccurrence[] = [];

  const append = (source: string, caption: string, sourceLine: number, sourceOffset: number) => {
    const localPath = resolveLocalImagePath(source, baseDir);
    occurrences.push({
      id: imageOccurrenceId(sourceOffset),
      source,
      localPath,
      caption,
      sourceLine,
      sourceOffset,
    });
  };

  const visit = (node: MarkdownNode) => {
    if (node.type === "image" && node.url) {
      append(
        node.url,
        node.alt ?? "",
        node.position?.start?.line ?? 1,
        node.position?.start?.offset ?? occurrences.length,
      );
    } else if (node.type === "html" && node.value) {
      for (const match of node.value.matchAll(htmlImagePattern)) {
        const tag = match[0];
        const source = match[2];
        if (!source) continue;
        const prefix = node.value.slice(0, match.index ?? 0);
        const lineDelta = prefix.split(/\r?\n/).length - 1;
        append(
          source,
          htmlAltPattern.exec(tag)?.[2] ?? "",
          (node.position?.start?.line ?? 1) + lineDelta,
          (node.position?.start?.offset ?? 0) + (match.index ?? 0),
        );
      }
    }
    node.children?.forEach(visit);
  };
  visit(root);
  return occurrences.sort((left, right) => left.sourceOffset - right.sourceOffset);
}

export function groupImageOccurrences(occurrences: ImageOccurrence[]): ImageOccurrenceGroup[] {
  const groups = new Map<string, ImageOccurrenceGroup>();
  for (const occurrence of occurrences) {
    const key = occurrence.localPath
      ? `local:${localPathIdentity(occurrence.localPath)}`
      : `source:${occurrence.source}`;
    const existing = groups.get(key);
    if (existing) {
      existing.occurrences.push(occurrence);
    } else {
      const path = occurrence.localPath ?? occurrence.source;
      groups.set(key, {
        path,
        source: occurrence.source,
        filename: getFileName(path),
        occurrences: [occurrence],
      });
    }
  }
  return [...groups.values()];
}
