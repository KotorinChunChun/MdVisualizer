import { codeFenceTitle, type CodeFenceOccurrence } from "./markdownOccurrences";
import type { EmbeddedPathStyle } from "../types/settings";

export interface CodeFencePathDecoration {
  occurrence: CodeFenceOccurrence;
  relativePath?: string;
  style?: EmbeddedPathStyle;
}

export function normalizeRelativeAssetPath(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const path = value.trim().replace(/^<|>$/g, "").split(/[?#]/, 1)[0].replace(/\\/g, "/");
  if (!path || /^(?:[a-z][a-z0-9+.-]*:|\/|[a-z]:\/)/i.test(path)) return undefined;
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return undefined;
  return path;
}

/** Removes only the final extension from the filename part of a safe relative path. */
export function removeFilenameExtension(value: string): string {
  const path = value.trim().replace(/^<|>$/g, "").split(/[?#]/, 1)[0].replace(/\\/g, "/");
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash + 1 ? path.slice(0, dot) : path;
}

/** Replaces or appends the final filename extension while preserving its relative directory. */
export function appendFilenameExtension(value: string, extension: string): string {
  const normalizedExtension = extension.trim().replace(/^\.+/, "").toLowerCase();
  const stem = removeFilenameExtension(value);
  return normalizedExtension ? `${stem}.${normalizedExtension}` : stem;
}

export function splitFenceLanguagePath(language: string): { language: string; relativePath?: string } {
  const separator = language.indexOf(":");
  if (separator <= 0) return { language };
  const relativePath = normalizeRelativeAssetPath(language.slice(separator + 1));
  return relativePath ? { language: language.slice(0, separator), relativePath } : { language };
}

function expandedOccurrence(markdown: string, occurrence: CodeFenceOccurrence, start: number): CodeFenceOccurrence {
  return {
    ...occurrence,
    start,
    expected: markdown.slice(start, occurrence.end),
    id: `code-fence:${start}:${occurrence.end}`,
  };
}

function codeFenceOpeningStart(occurrence: CodeFenceOccurrence): number {
  const start = occurrence.bodyStart - occurrence.opening.length;
  return start >= 0 ? start : occurrence.start;
}

function previousDescriptorLine(markdown: string, occurrenceStart: number): { line: string; start: number } | undefined {
  let cursor = Math.max(markdown.lastIndexOf("\n", Math.max(0, occurrenceStart - 1)), markdown.lastIndexOf("\r", Math.max(0, occurrenceStart - 1))) + 1;
  while (cursor > 0) {
    let end = cursor;
    if (markdown[end - 1] === "\n") end -= 1;
    if (markdown[end - 1] === "\r") end -= 1;
    const previousBreak = Math.max(markdown.lastIndexOf("\n", Math.max(0, end - 1)), markdown.lastIndexOf("\r", Math.max(0, end - 1)));
    const start = previousBreak + 1;
    const line = markdown.slice(start, end);
    if (!/^(?:[ \t]*>[ \t]?)*[ \t]*$/.test(line)) return { line, start };
    cursor = start;
  }
  return undefined;
}

const descriptorPrefix = String.raw`((?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?)`;
const headingDescriptor = new RegExp(`^${descriptorPrefix}(#{1,6}[ \\t]+(.+?)[ \\t]*#?[ \\t]*)$`);
const boldCodeDescriptor = new RegExp(`^${descriptorPrefix}(\\*\\*\x60([^\x60\\r\\n]+)\x60\\*\\*)[ \\t]*$`);

export function codeFencePathDecoration(markdown: string, occurrence: CodeFenceOccurrence): CodeFencePathDecoration {
  const titlePath = normalizeRelativeAssetPath(codeFenceTitle(occurrence.meta));
  if (titlePath) return { occurrence, relativePath: titlePath, style: "fence-title" };
  const colon = splitFenceLanguagePath(occurrence.language);
  if (colon.relativePath) return { occurrence, relativePath: colon.relativePath, style: "fence-colon" };

  const descriptor = previousDescriptorLine(markdown, codeFenceOpeningStart(occurrence));
  const heading = descriptor ? headingDescriptor.exec(descriptor.line) : null;
  const headingPath = normalizeRelativeAssetPath(heading?.[3]);
  if (descriptor && heading && headingPath) {
    const start = descriptor.start + heading[1].length;
    return { occurrence: expandedOccurrence(markdown, occurrence, start), relativePath: headingPath, style: "heading" };
  }

  const bold = descriptor ? boldCodeDescriptor.exec(descriptor.line) : null;
  const boldPath = normalizeRelativeAssetPath(bold?.[3]);
  if (descriptor && bold && boldPath) {
    const start = descriptor.start + bold[1].length;
    return { occurrence: expandedOccurrence(markdown, occurrence, start), relativePath: boldPath, style: "bold-code" };
  }
  return { occurrence };
}

export function markdownContinuationPrefix(markdown: string, start: number): string {
  const lineStart = Math.max(markdown.lastIndexOf("\n", Math.max(0, start - 1)), markdown.lastIndexOf("\r", Math.max(0, start - 1))) + 1;
  const prefix = markdown.slice(lineStart, start);
  const match = /^((?:[ \t]*>[ \t]?)*)([ \t]*)(?:(?:[-+*]|\d+[.)])[ \t]+)?$/.exec(prefix);
  if (!match) return "";
  const listWidth = prefix.length - match[1].length - match[2].length;
  return `${match[1]}${match[2]}${" ".repeat(Math.max(0, listWidth))}`;
}

function escapeTitlePath(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function embeddedFenceWithPath({ language, body, relativePath, style, lineEnding = "\n", continuationPrefix = "" }: {
  language: string;
  body: string;
  relativePath: string;
  style: EmbeddedPathStyle;
  lineEnding?: "\n" | "\r\n" | "\r";
  continuationPrefix?: string;
}): string {
  const normalizedPath = removeFilenameExtension(normalizeRelativeAssetPath(relativePath) ?? relativePath.replace(/\\/g, "/"));
  const normalizedBody = body.trim().replace(/\r\n|\r|\n/g, lineEnding);
  const longestBacktickRun = Math.max(0, ...Array.from(normalizedBody.matchAll(/`+/g), (match) => match[0].length));
  const marker = "`".repeat(Math.max(3, longestBacktickRun + 1));
  const opening = style === "fence-title"
    ? `${marker}${language} title="${escapeTitlePath(normalizedPath)}"`
    : style === "fence-colon" ? `${marker}${language}:${normalizedPath}` : `${marker}${language}`;
  const descriptor = style === "heading" ? `### ${normalizedPath}` : style === "bold-code" ? `**\`${normalizedPath}\`**` : undefined;
  const lines = [...(descriptor ? [descriptor, ""] : []), opening, normalizedBody, marker];
  return lines.map((line, index) => `${index > 0 ? continuationPrefix : ""}${line}`).join(lineEnding);
}
