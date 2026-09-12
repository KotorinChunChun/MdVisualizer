import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { EditorSnapshot } from "./model";

export type CodexEditMode = "question" | "selection" | "document";
export interface CodexTarget extends EditorSnapshot { imageSource?: string; label?: string }
type Node = { type: string; url?: string; position?: { start: { line: number; offset: number }; end: { line: number; offset: number } }; children?: Node[] };
const parser = unified().use(remarkParse).use(remarkGfm);

export function targetAtLine(content: string, line: number, selectedText = "", image = false): { from: number; to: number; imageSource?: string } | null {
  const candidates: Node[] = [];
  function visit(node: Node) {
    const p = node.position;
    if (p && p.start.line <= line && p.end.line >= line && ["paragraph", "code", "heading", "table", "image", "html", "listItem"].includes(node.type)) candidates.push(node);
    node.children?.forEach(visit);
  }
  visit(parser.parse(content) as unknown as Node);
  const candidate = candidates.filter((node) => image ? node.type === "image" : node.type !== "image").sort((a, b) => (a.position!.end.offset - a.position!.start.offset) - (b.position!.end.offset - b.position!.start.offset))[0];
  if (!candidate?.position) return null;
  const { start, end } = candidate.position;
  if (selectedText && !image) {
    const block = content.slice(start.offset, end.offset);
    const offset = block.indexOf(selectedText);
    if (offset < 0 || block.indexOf(selectedText, offset + 1) >= 0) return null;
    return { from: start.offset + offset, to: start.offset + offset + selectedText.length };
  }
  return { from: start.offset, to: end.offset, ...(image ? { imageSource: candidate.url } : {}) };
}

export function scopeRequest(current: EditorSnapshot, selected: EditorSnapshot | null, mode: CodexEditMode, instruction: string) {
  const target = selected ?? { ...current, from: 0, to: current.content.length };
  const base = mode === "document" ? { ...current, from: 0, to: current.content.length } : target;
  const rule = mode === "question" ? "質問への回答のみ。編集は許可されていません。replacementは必ずnullにしてください。"
    : mode === "selection" ? "指定場所のみ編集できます。replacementには渡された対象部分の置換後テキストだけを返してください。"
    : `同じ文書内で指定場所以外の編集も許可されています。replacementには文書全体を返してください。相談の中心は文字位置${target.from}〜${target.to}の部分です。別ファイルの編集は許可されていません。`;
  return { base, text: base.content.slice(base.from, base.to), instruction: `${instruction}\n\n編集許可: ${rule}` };
}
