import { MarkdownOccurrenceConflictError, replaceMarkdownOccurrence, type ImageMarkdownOccurrence, type InlineSvgOccurrence } from "./markdownOccurrences";

export type AssetConversionContext = {
  documentPath: string;
  occurrence: ImageMarkdownOccurrence | InlineSvgOccurrence;
  assetKind: "raster" | "svg";
  storage: "embedded" | "external";
};

export function parseRasterDataUri(source: string): { mediaType: string; extension: string; base64: string } | null {
  const match = /^data:(image\/(?:png|jpe?g|gif|webp|bmp));base64,([a-z0-9+/=\s]+)$/i.exec(source);
  if (!match) return null;
  const mediaType = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
  return { mediaType, extension: mediaType === "image/jpeg" ? "jpg" : mediaType.slice(6), base64: match[2].replace(/\s/g, "") };
}

export function replaceImageOccurrenceSource(markdown: string, occurrence: ImageMarkdownOccurrence, source: string): string {
  const relative = occurrence.expected.lastIndexOf(occurrence.source);
  if (relative < 0) throw new MarkdownOccurrenceConflictError();
  const replacement = `${occurrence.expected.slice(0, relative)}${source}${occurrence.expected.slice(relative + occurrence.source.length)}`;
  return replaceMarkdownOccurrence(markdown, occurrence, replacement);
}

export function preferredAssetFilename(context: AssetConversionContext, extension: string): string {
  const label = context.occurrence.kind === "image" ? context.occurrence.caption : context.assetKind === "svg" ? "diagram" : "image";
  const stem = label.trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || (context.assetKind === "svg" ? "diagram" : "image");
  return `${stem}.${extension}`;
}
