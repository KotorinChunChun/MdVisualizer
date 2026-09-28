import {
  collectEditableMarkdownOccurrences,
  MarkdownOccurrenceConflictError,
  replaceMarkdownOccurrence,
  type EditableMarkdownOccurrence,
} from "./markdownOccurrences";
import { codeFencePathDecoration, splitFenceLanguagePath } from "./externalPathRepresentation";

function relocationCandidates(markdown: string): EditableMarkdownOccurrence[] {
  const result: EditableMarkdownOccurrence[] = [];
  for (const candidate of collectEditableMarkdownOccurrences(markdown)) {
    result.push(candidate);
    if (candidate.kind === "code-fence") result.push(codeFencePathDecoration(markdown, candidate).occurrence);
  }
  return result;
}

/**
 * Resolves the same unchanged Markdown element after reloading storage. The
 * element text must still match exactly; only offset shifts caused by edits to
 * other parts of the document are tolerated.
 */
export function relocateUnchangedOccurrence(
  markdown: string,
  original: EditableMarkdownOccurrence,
): EditableMarkdownOccurrence {
  const candidates = relocationCandidates(markdown)
    .filter((candidate, index, all) => candidate.kind === original.kind && candidate.expected === original.expected
      && all.findIndex(item => item.start === candidate.start && item.end === candidate.end && item.kind === candidate.kind) === index);
  const match = candidates.find(candidate => candidate.start === original.start && candidate.end === original.end)
    ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!match) throw new MarkdownOccurrenceConflictError();
  return match;
}

export function planOccurrenceConversion(stored: string, draft: string, occurrence: EditableMarkdownOccurrence, replacement: string): { draft: string; stored: string | null } {
  // The selected draft is authoritative. Missing storage is expected for new
  // content; a changed draft is not an excuse to guess another occurrence.
  const nextDraft = replaceRelocatedOccurrence(draft, occurrence, replacement);
  let nextStored: string | null = null;
  const count = (value: string) => collectEditableMarkdownOccurrences(value).filter(item => item.kind === occurrence.kind && item.expected === occurrence.expected).length;
  if (count(draft) > 1 && count(draft) !== count(stored)) return { draft: nextDraft, stored: null };
  try { nextStored = replaceRelocatedOccurrence(stored, occurrence, replacement); } catch { /* draft-only target */ }
  return { draft: nextDraft, stored: nextStored };
}

function similarityScore(candidate: EditableMarkdownOccurrence, original: EditableMarkdownOccurrence): number {
  let score = Math.abs(candidate.start - original.start) + Math.abs(candidate.expected.length - original.expected.length) * 2;
  if (candidate.kind !== original.kind) score += 20_000;
  if (candidate.kind === "code-fence" && original.kind === "code-fence") {
    if (splitFenceLanguagePath(candidate.language).language !== splitFenceLanguagePath(original.language).language) score += 100_000;
    score += Math.abs(candidate.body.length - original.body.length) * 3;
  } else if (candidate.kind === "image" && original.kind === "image") {
    const extension = (value: string) => /\.([a-z0-9]+)(?:[?#]|$)/i.exec(value)?.[1]?.toLowerCase() ?? "";
    if (extension(candidate.source) !== extension(original.source)) score += 50_000;
    score += Math.abs(candidate.source.length - original.source.length) * 3;
  }
  return score;
}

function isCompatibleBaselineCandidate(candidate: EditableMarkdownOccurrence, original: EditableMarkdownOccurrence): boolean {
  if (candidate.kind !== original.kind) return false;
  if (candidate.kind === "code-fence" && original.kind === "code-fence") {
    return splitFenceLanguagePath(candidate.language).language === splitFenceLanguagePath(original.language).language;
  }
  if (candidate.kind === "image" && original.kind === "image") {
    const extension = (value: string) => /\.([a-z0-9]+)(?:[?#]|$)/i.exec(value)?.[1]?.toLowerCase() ?? "";
    return extension(candidate.source) === extension(original.source);
  }
  return true;
}

/**
 * Updates the saved Diff baseline after a forced storage conversion.
 * Exact text is preferred; when the baseline predates another confirmed
 * conversion, the closest same-kind candidate is selected by position,
 * source length, body length, language, and extension.
 */
export function replaceBestEffortOccurrence(
  markdown: string,
  original: EditableMarkdownOccurrence,
  replacement: string,
): string {
  try { return replaceRelocatedOccurrence(markdown, original, replacement); }
  catch {
    const candidates = relocationCandidates(markdown)
      .filter((candidate) => isCompatibleBaselineCandidate(candidate, original))
      .sort((left, right) => similarityScore(left, original) - similarityScore(right, original));
    const candidate = candidates[0];
    if (!candidate) throw new MarkdownOccurrenceConflictError();
    return replaceMarkdownOccurrence(markdown, candidate, replacement);
  }
}

export function replaceRelocatedOccurrence(
  markdown: string,
  original: EditableMarkdownOccurrence,
  replacement: string,
): string {
  return replaceMarkdownOccurrence(markdown, relocateUnchangedOccurrence(markdown, original), replacement);
}
