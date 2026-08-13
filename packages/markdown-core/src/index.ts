export type MarkdownEditAction =
  | "heading"
  | "bold"
  | "italic"
  | "strike"
  | "quote"
  | "unordered-list"
  | "ordered-list"
  | "task-list"
  | "link"
  | "inline-code"
  | "code-block"
  | "table"
  | "mermaid"
  | "horizontal-rule"
  | "drawio"
  | "image";

export {
  buildStructuredListEnter,
  buildOrderedListNormalization,
  buildStructuredListIndent,
  buildStructuredListMove,
  buildStructuredListPaste,
  buildStructuredListToggle,
  parseMarkdownListLine,
  renumberOrderedLists,
  type MarkdownListLine,
  type StructuredListKind,
} from "./structuredLists";

export {
  moveHeadingBlock,
  normalizeNumberedHeadings,
  parseMarkdownHeadingBlocks,
  type MarkdownHeadingBlock,
} from "./structuredHeadings";

export interface MarkdownEditChange {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head: number;
}

export type MarkdownLineEnding = "\n" | "\r\n" | "\r";

export interface MarkdownTextFormat {
  lineEnding: MarkdownLineEnding;
  hasBom: boolean;
}

export const MARKDOWN_DOCUMENT_PATTERN = /\.(?:md|markdown)$/i;
export const MARKDOWN_FORBIDDEN_TAGS = ["script", "iframe", "object", "embed", "form"] as const;
export const MARKDOWN_ALLOWED_LINK_PROTOCOLS = ["http", "https", "mailto", "spmd"] as const;
export const MARKDOWN_ALLOWED_IMAGE_PROTOCOLS = ["http", "https", "data"] as const;

export function isMarkdownDocumentName(value: string): boolean {
  return MARKDOWN_DOCUMENT_PATTERN.test(value.trim());
}

export function detectLineEnding(value: string): MarkdownLineEnding {
  if (value.includes("\r\n")) return "\r\n";
  if (value.includes("\r")) return "\r";
  return "\n";
}

export function normalizeLineEndings(value: string, lineEnding: MarkdownLineEnding): string {
  return value.replace(/\r\n|\r|\n/g, "\n").replace(/\n/g, lineEnding);
}

export function detectMarkdownTextFormat(value: string): MarkdownTextFormat {
  return {
    lineEnding: detectLineEnding(value),
    hasBom: value.startsWith("\uFEFF"),
  };
}

function wrapped(from: number, to: number, selected: string, prefix: string, suffix: string, placeholder: string): MarkdownEditChange {
  const body = selected || placeholder;
  return {
    from,
    to,
    insert: `${prefix}${body}${suffix}`,
    anchor: from + prefix.length,
    head: from + prefix.length + body.length,
  };
}

function inserted(from: number, to: number, value: string, selection?: [number, number]): MarkdownEditChange {
  const [start, end] = selection ?? [value.length, value.length];
  return { from, to, insert: value, anchor: from + start, head: from + end };
}

function linePrefixChange(source: string, from: number, to: number, prefix: (index: number) => string): MarkdownEditChange {
  const lineStart = source.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const nextLine = source.indexOf("\n", to);
  const lineEnd = nextLine < 0 ? source.length : nextLine;
  const lines = source.slice(lineStart, lineEnd).split("\n");
  const insert = lines.map((line, index) => `${prefix(index)}${line}`).join("\n");
  return { from: lineStart, to: lineEnd, insert, anchor: lineStart, head: lineStart + insert.length };
}

export function buildMarkdownEdit(source: string, from: number, to: number, action: MarkdownEditAction): MarkdownEditChange {
  const start = Math.max(0, Math.min(from, source.length));
  const end = Math.max(start, Math.min(to, source.length));
  const selected = source.slice(start, end);
  switch (action) {
    case "heading": {
      const lineStart = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const lineEnd = source.indexOf("\n", lineStart);
      const endOfLine = lineEnd < 0 ? source.length : lineEnd;
      const line = source.slice(lineStart, endOfLine);
      const existing = line.match(/^#{1,6}\s+/)?.[0] ?? "";
      const insert = `# ${line.slice(existing.length)}`;
      return { from: lineStart, to: endOfLine, insert, anchor: lineStart + 2, head: lineStart + insert.length };
    }
    case "bold": return wrapped(start, end, selected, "**", "**", "太字");
    case "italic": return wrapped(start, end, selected, "_", "_", "斜体");
    case "strike": return wrapped(start, end, selected, "~~", "~~", "取り消し線");
    case "inline-code": return wrapped(start, end, selected, "`", "`", "コード");
    case "quote": return linePrefixChange(source, start, end, () => "> ");
    case "unordered-list": return linePrefixChange(source, start, end, () => "- ");
    case "ordered-list": return linePrefixChange(source, start, end, (index) => `${index + 1}. `);
    case "task-list": return linePrefixChange(source, start, end, () => "- [ ] ");
    case "link": {
      const label = selected || "リンク";
      const insert = `[${label}](https://)`;
      const urlStart = insert.indexOf("https://");
      return inserted(start, end, insert, [urlStart, urlStart + "https://".length]);
    }
    case "code-block": {
      const body = selected || "コード";
      const insert = `\n\n\`\`\`text\n${body}\n\`\`\`\n\n`;
      const bodyStart = insert.indexOf(body);
      return inserted(start, end, insert, [bodyStart, bodyStart + body.length]);
    }
    case "table": {
      const insert = "\n\n| 列1 | 列2 |\n| --- | --- |\n| 値1 | 値2 |\n\n";
      return inserted(start, end, insert, [insert.indexOf("列1"), insert.indexOf("列1") + 2]);
    }
    case "mermaid": {
      const body = selected || "graph TD\n  A --> B";
      const insert = `\n\n\`\`\`mermaid\n${body}\n\`\`\`\n\n`;
      const bodyStart = insert.indexOf(body);
      return inserted(start, end, insert, [bodyStart, bodyStart + body.length]);
    }
    case "horizontal-rule": return inserted(start, end, "\n\n---\n\n");
    case "drawio": {
      const body = selected || '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
      const insert = `\n\n\`\`\`drawio\n${body}\n\`\`\`\n\n`;
      const bodyStart = insert.indexOf(body);
      return inserted(start, end, insert, [bodyStart, bodyStart + body.length]);
    }
    case "image": {
      const label = selected || "画像";
      const insert = `![${label}](image.png)`;
      const pathStart = insert.indexOf("image.png");
      return inserted(start, end, insert, [pathStart, pathStart + "image.png".length]);
    }
  }
}
