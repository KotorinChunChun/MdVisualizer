import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

type MarkdownNode = { type?: string; value?: string; url?: string; alt?: string | null; position?: { start?: { offset?: number }; end?: { offset?: number } }; children?: MarkdownNode[] };

export type PreviewInlineEditLeaf = { id: string; from: number; to: number; nodeFrom: number; value: string; kind: "text" | "inline-code" | "image-alt" };
export type PreviewInlineEditBinding = { renderedFrom: number; id: string };

const parser = unified().use(remarkParse).use(remarkGfm);

function offsets(node: MarkdownNode): [number, number] | null {
  const from = node.position?.start?.offset;
  const to = node.position?.end?.offset;
  return Number.isInteger(from) && Number.isInteger(to) && from! <= to! ? [from!, to!] : null;
}

function inlineCodeRange(source: string, from: number, to: number, value: string): [number, number] | null {
  const raw = source.slice(from, to);
  const match = raw.match(/^(?<ticks>`+)(?<body>[\s\S]*)(\k<ticks>)$/);
  if (!match?.groups?.ticks || match.groups.body === undefined) return null;
  const bodyFrom = from + match.groups.ticks.length;
  // remark normalizes one surrounding space in an inline code span.
  const candidate = source.indexOf(value, bodyFrom);
  return candidate >= bodyFrom && candidate + value.length <= to - match.groups.ticks.length
    ? [candidate, candidate + value.length]
    : [bodyFrom, to - match.groups.ticks.length];
}

function imageAltRange(source: string, from: number, to: number): [number, number] | null {
  const raw = source.slice(from, to);
  const start = raw.indexOf("![");
  if (start < 0) return null;
  let depth = 1;
  let escaped = false;
  for (let index = start + 2; index < raw.length; index += 1) {
    const character = raw[index]!;
    if (escaped) { escaped = false; continue; }
    if (character === "\\") { escaped = true; continue; }
    if (character === "[") depth += 1;
    if (character === "]" && --depth === 0) return [from + start + 2, from + index];
  }
  return null;
}

/** Collects source ranges whose replacement cannot change surrounding Markdown structure. */
export function collectPreviewInlineEditLeaves(source: string): PreviewInlineEditLeaf[] {
  const leaves: PreviewInlineEditLeaf[] = [];
  const visit = (node: MarkdownNode) => {
    const range = offsets(node);
    if (node.type === "text" && range && typeof node.value === "string" && node.value.length > 0) {
      leaves.push({ id: `text:${range[0]}:${range[1]}`, from: range[0], to: range[1], nodeFrom: range[0], value: node.value, kind: "text" });
    } else if (node.type === "inlineCode" && range && typeof node.value === "string") {
      const contentRange = inlineCodeRange(source, range[0], range[1], node.value);
      if (contentRange) leaves.push({ id: `code:${contentRange[0]}:${contentRange[1]}`, from: contentRange[0], to: contentRange[1], nodeFrom: range[0], value: node.value, kind: "inline-code" });
    } else if (node.type === "image" && range) {
      const alt = node.alt ?? "";
      const altRange = imageAltRange(source, range[0], range[1]);
      if (altRange) leaves.push({ id: `image:${altRange[0]}:${altRange[1]}`, from: altRange[0], to: altRange[1], nodeFrom: range[0], value: alt, kind: "image-alt" });
    }
    node.children?.forEach(visit);
  };
  visit(parser.parse(source) as MarkdownNode);
  return leaves;
}

/** Maps rendered AST positions back to original Markdown only when every semantic leaf agrees. */
export function bindRenderedPreviewInlineEditLeaves(source: string, rendered: string): PreviewInlineEditBinding[] {
  const original = collectPreviewInlineEditLeaves(source);
  const renderedLeaves = collectPreviewInlineEditLeaves(rendered);
  if (original.length !== renderedLeaves.length || original.some((leaf, index) => leaf.kind !== renderedLeaves[index]?.kind || leaf.value !== renderedLeaves[index]?.value)) return [];
  return original.map((leaf, index) => ({ renderedFrom: renderedLeaves[index]!.nodeFrom, id: leaf.id }));
}

/** Escapes replacement text so a direct preview edit remains text in its existing Markdown context. */
export function escapePreviewInlineReplacement(value: string, kind: PreviewInlineEditLeaf["kind"]): string {
  if (kind === "inline-code") {
    if (value.includes("`")) throw new Error("インラインコードにバッククォートは入力できません。コード記法を保つため、先にエディターで区切りを変更してください。");
    return value;
  }
  return value.split(/(\r\n|\r|\n)/).map((line, index) => {
    if (index % 2) return line;
    const escaped = line.replace(/\\/g, "\\\\").replace(/([`*_[\]<>#+\-=!|~])/g, "\\$1");
    return escaped.replace(/^(\d+)\\?\./, "$1\\.").replace(/&/g, "&amp;");
  }).join("");
}
