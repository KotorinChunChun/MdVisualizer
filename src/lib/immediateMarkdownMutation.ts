import {
  collectEditableMarkdownOccurrences,
  MarkdownOccurrenceConflictError,
  replaceMarkdownOccurrence,
  type EditableMarkdownOccurrence,
} from "./markdownOccurrences";

/**
 * Resolves the same unchanged Markdown element after reloading storage. The
 * element text must still match exactly; only offset shifts caused by edits to
 * other parts of the document are tolerated.
 */
export function relocateUnchangedOccurrence(
  markdown: string,
  original: EditableMarkdownOccurrence,
): EditableMarkdownOccurrence {
  const candidates = collectEditableMarkdownOccurrences(markdown)
    .filter((candidate) => candidate.kind === original.kind && candidate.expected === original.expected)
    .sort((left, right) => Math.abs(left.start - original.start) - Math.abs(right.start - original.start));
  const match = candidates[0];
  if (!match) throw new MarkdownOccurrenceConflictError();
  return match;
}

export function replaceRelocatedOccurrence(
  markdown: string,
  original: EditableMarkdownOccurrence,
  replacement: string,
): string {
  return replaceMarkdownOccurrence(markdown, relocateUnchangedOccurrence(markdown, original), replacement);
}
