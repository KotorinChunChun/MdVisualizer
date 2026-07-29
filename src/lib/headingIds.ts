/**
 * Generates the document-stable identifier shared by normal folding and
 * presentation pages.  NFKC is intentional: visually equivalent heading
 * forms (for example, `①` and `1`) must return to the same folded section.
 */
export function slugifyHeading(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/(^-|-$)/g, "") || "section";
}

/** Allocates a unique, deterministic ID for repeated headings. */
export function nextHeadingId(counts: Map<string, number>, text: string): string {
  const base = slugifyHeading(text);
  const occurrence = (counts.get(base) ?? 0) + 1;
  counts.set(base, occurrence);
  return occurrence === 1 ? base : `${base}-${occurrence}`;
}
