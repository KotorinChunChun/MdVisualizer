type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: { start?: { line?: number } };
};

const BLOCK_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "li", "pre", "table", "blockquote", "img", "hr",
]);

function textContent(node: HastNode): string {
  if (typeof node.value === "string") return node.value;
  return node.children?.map(textContent).join(" ") ?? "";
}

export function normalizeAnchorText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase().slice(0, 240);
}

export function hashAnchorText(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function assignBlockAnchors(
  node: HastNode,
  foldId: string,
  occurrences: Map<string, number>,
) {
  if (node.type !== "element") {
    node.children?.forEach((child) => assignBlockAnchors(child, foldId, occurrences));
    return;
  }

  const nodeFoldId = String(node.properties?.["data-fold-id"] ?? foldId);
  const tagName = node.tagName?.toLowerCase() ?? "";
  if (BLOCK_TAGS.has(tagName)) {
    const normalizedText = normalizeAnchorText(textContent(node));
    const fingerprint = hashAnchorText(`${tagName}:${normalizedText}`);
    const occurrenceKey = `${nodeFoldId}:${fingerprint}`;
    const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
    occurrences.set(occurrenceKey, occurrence);
    node.properties = {
      ...node.properties,
      "data-block-id": `${nodeFoldId}:${tagName}:${fingerprint}:${occurrence}`,
      "data-block-fold-id": nodeFoldId,
      "data-source-line": node.position?.start?.line ?? undefined,
    };
  }

  node.children?.forEach((child) => assignBlockAnchors(child, nodeFoldId, occurrences));
}

/** Adds deterministic anchors used to restore the same visible text after reload. */
export function rehypeBlockAnchors() {
  return (tree: HastNode) => assignBlockAnchors(tree, "root", new Map());
}

export const __test__ = { assignBlockAnchors };
