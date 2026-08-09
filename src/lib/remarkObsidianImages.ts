type PositionPoint = {
  line: number;
  column: number;
  offset?: number;
};

type Position = {
  start: PositionPoint;
  end: PositionPoint;
};

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  position?: Position;
  url?: string;
  alt?: string;
  title?: string | null;
  data?: {
    hProperties?: Record<string, string>;
  };
};

const OBSIDIAN_EMBED_PATTERN = /!?\[\[([^\]\r\n]+)\]\]/g;
const IMAGE_EXTENSION_PATTERN = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)(?:[?#].*)?$/i;
const SIZE_ALIAS_PATTERN = /^\d+(?:x\d+)?$/i;
const SKIPPED_PARENT_TYPES = new Set(["image", "link", "definition", "code", "inlineCode", "html"]);

export interface ObsidianImageReference {
  source: string;
  alt: string;
}

export interface ObsidianMarkdownLinkReference {
  source: string;
  label: string;
}

export function parseObsidianImageReference(value: string): ObsidianImageReference | null {
  const separator = value.indexOf("|");
  const source = (separator >= 0 ? value.slice(0, separator) : value).trim();
  if (!source || !IMAGE_EXTENSION_PATTERN.test(source)) return null;
  const alias = separator >= 0 ? value.slice(separator + 1).trim() : "";
  return {
    source,
    alt: alias && !SIZE_ALIAS_PATTERN.test(alias) ? alias : "",
  };
}

export function parseObsidianMarkdownLinkReference(value: string): ObsidianMarkdownLinkReference | null {
  const separator = value.indexOf("|");
  const source = (separator >= 0 ? value.slice(0, separator) : value).trim();
  if (!source || !/\.(?:md|markdown|mmd|mermaid)(?:[?#].*)?$/i.test(source)) return null;
  const alias = separator >= 0 ? value.slice(separator + 1).trim() : "";
  return { source, label: alias || source };
}

function pointAt(node: MarkdownNode, index: number): PositionPoint | undefined {
  if (!node.position || node.value === undefined) return undefined;
  const prefix = node.value.slice(0, index);
  const lines = prefix.split("\n");
  return {
    line: node.position.start.line + lines.length - 1,
    column: lines.length === 1
      ? node.position.start.column + prefix.length
      : lines[lines.length - 1].length + 1,
    offset: node.position.start.offset === undefined
      ? undefined
      : node.position.start.offset + index,
  };
}

function positionedText(node: MarkdownNode, value: string, start: number, end: number): MarkdownNode {
  const positionStart = pointAt(node, start);
  const positionEnd = pointAt(node, end);
  return {
    type: "text",
    value,
    position: positionStart && positionEnd ? { start: positionStart, end: positionEnd } : undefined,
  };
}

function transformText(node: MarkdownNode): MarkdownNode[] {
  const value = node.value ?? "";
  const transformed: MarkdownNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(OBSIDIAN_EMBED_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const imageReference = parseObsidianImageReference(match[1]);
    const linkReference = !match[0].startsWith("!") ? parseObsidianMarkdownLinkReference(match[1]) : null;
    if (!imageReference && !linkReference) continue;
    if (start > cursor) transformed.push(positionedText(node, value.slice(cursor, start), cursor, start));
    const positionStart = pointAt(node, start);
    const positionEnd = pointAt(node, end);
    if (imageReference) {
      transformed.push({
        type: "image",
        url: imageReference.source,
        alt: imageReference.alt,
        title: null,
        data: { hProperties: { "data-obsidian-image": "true" } },
        position: positionStart && positionEnd ? { start: positionStart, end: positionEnd } : undefined,
      });
    } else if (linkReference) {
      transformed.push({
        type: "link",
        url: linkReference.source,
        children: [{ type: "text", value: linkReference.label }],
        position: positionStart && positionEnd ? { start: positionStart, end: positionEnd } : undefined,
      });
    }
    cursor = end;
  }
  if (cursor === 0) return [node];
  if (cursor < value.length) transformed.push(positionedText(node, value.slice(cursor), cursor, value.length));
  return transformed;
}

function transformChildren(node: MarkdownNode) {
  if (!node.children || SKIPPED_PARENT_TYPES.has(node.type)) return;
  const children: MarkdownNode[] = [];
  for (const child of node.children) {
    if (child.type === "text") {
      children.push(...transformText(child));
    } else {
      transformChildren(child);
      children.push(child);
    }
  }
  node.children = children;
}

/** Converts Obsidian image embeds and local document wiki links to Markdown AST nodes. */
export function remarkObsidianImages() {
  return (tree: MarkdownNode) => transformChildren(tree);
}
