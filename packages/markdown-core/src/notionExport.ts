/** Resolves links and images from an expanded Notion Markdown export. */
export function resolveExpandedExportReference(reference: string, documentPath: string, origin: string): string | null {
  if (!reference || reference.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)) return null;
  try {
    return new URL(reference, new URL(documentPath, origin)).toString();
  } catch {
    return null;
  }
}
