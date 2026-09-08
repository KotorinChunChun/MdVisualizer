import { replaceImageOccurrenceSource } from "./assetConversion";
import { collectEditableMarkdownOccurrences, type ImageMarkdownOccurrence } from "./markdownOccurrences";
import { getFileName, resolveLocalImagePath } from "./path";
import { localPathIdentity } from "./pathIdentity";

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/;

export function compactExternalFilename(filename: string): string {
  return filename.length > 20 ? `${filename.slice(0, 10)}.....${filename.slice(-5)}` : filename;
}

export function validateExternalFilename(filename: string): string | null {
  const trimmed = filename.trim();
  if (!trimmed) return "ファイル名を入力してください。";
  if (trimmed === "." || trimmed === "..") return "このファイル名は使用できません。";
  if (INVALID_FILENAME_CHARS.test(trimmed)) return "ファイル名に使用できない文字が含まれています。";
  if (/[. ]$/.test(filename)) return "ファイル名の末尾にピリオドや空白は使用できません。";
  return null;
}

export function replaceExternalSourceFilename(source: string, filename: string): string {
  const suffixIndex = source.search(/[?#]/);
  const path = suffixIndex >= 0 ? source.slice(0, suffixIndex) : source;
  const suffix = suffixIndex >= 0 ? source.slice(suffixIndex) : "";
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return `${separator >= 0 ? path.slice(0, separator + 1) : ""}${filename}${suffix}`;
}

export function externalFilename(source: string, path?: string | null): string {
  return getFileName(path || source).split(/[?#]/, 1)[0];
}

export function splitExternalFilename(filename: string): { stem: string; extension: string } {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? { stem: filename.slice(0, dot), extension: filename.slice(dot) } : { stem: filename, extension: "" };
}

export function rebaseRenamedExternalReferences(markdown: string, baseDir: string, oldPath: string, filename: string): string {
  const matches = collectEditableMarkdownOccurrences(markdown)
    .filter((occurrence): occurrence is ImageMarkdownOccurrence => occurrence.kind === "image")
    .filter((occurrence) => {
      const resolved = resolveLocalImagePath(occurrence.source, baseDir);
      return resolved !== null && localPathIdentity(resolved) === localPathIdentity(oldPath);
    })
    .sort((left, right) => right.start - left.start);
  return matches.reduce(
    (content, occurrence) => replaceImageOccurrenceSource(content, occurrence, replaceExternalSourceFilename(occurrence.source, filename)),
    markdown,
  );
}
