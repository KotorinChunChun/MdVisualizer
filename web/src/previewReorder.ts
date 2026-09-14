import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

export interface PreviewMoveUnit {
  id: string;
  startLine: number;
  endLine: number;
  group: string;
  label: string;
}

type Position = { start: { line: number; offset: number }; end: { line: number; offset: number } };
type MarkdownNode = {
  type: string;
  value?: string;
  depth?: number;
  position?: Position;
  children?: MarkdownNode[];
};

type LocatedUnit = PreviewMoveUnit & { start: number; end: number };

const parser = unified().use(remarkParse).use(remarkGfm);
const rootBlockTypes = new Set(["heading", "paragraph", "blockquote", "code", "thematicBreak", "list", "table"]);

function parse(markdown: string): MarkdownNode | null {
  try {
    return parser.parse(markdown) as unknown as MarkdownNode;
  } catch {
    return null;
  }
}

function sourceText(node: MarkdownNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(sourceText).join("");
}

function labelFor(node: MarkdownNode): string {
  const text = sourceText(node).replace(/\s+/g, " ").trim();
  const label = node.type === "heading" ? text || "見出し"
    : node.type === "code" ? "コードブロック"
      : node.type === "table" ? "表"
        : node.type === "list" ? "リスト"
          : node.type === "listItem" ? text || "リスト項目"
            : node.type === "blockquote" ? text || "引用"
              : node.type === "thematicBreak" ? "区切り線"
                : text || "段落";
  return label.slice(0, 80);
}

function unit(node: MarkdownNode, id: string, group: string): LocatedUnit | null {
  const position = node.position;
  if (!position || !Number.isInteger(position.start.offset) || !Number.isInteger(position.end.offset)) return null;
  return {
    id,
    group,
    label: labelFor(node),
    startLine: position.start.line,
    endLine: position.end.line,
    start: position.start.offset,
    end: position.end.offset,
  };
}

function isSafeNode(node: MarkdownNode): boolean {
  return node.type !== "html" && (node.children ?? []).every(isSafeNode);
}

function collectLocatedUnits(markdown: string): LocatedUnit[] {
  const root = parse(markdown);
  if (!root) return [];
  const result: LocatedUnit[] = [];
  let rootSegment = 0;
  for (const node of root.children ?? []) {
    const position = node.position;
    // Definitions, front matter and raw HTML stay in their original source
    // slot.  They form a barrier, but do not disable independent safe blocks.
    if (!position || !rootBlockTypes.has(node.type) || !isSafeNode(node)) {
      rootSegment += 1;
      continue;
    }
    const rootUnit = unit(node, `r:${position.start.offset}`, `root:${rootSegment}`);
    if (rootUnit) result.push(rootUnit);
    if (node.type === "list") {
      const group = `l:${position.start.offset}`;
      for (const item of node.children ?? []) {
        const itemPosition = item.position;
        if (!itemPosition || item.type !== "listItem") continue;
        const itemUnit = unit(item, `l:${position.start.offset}:${itemPosition.start.offset}`, group);
        if (itemUnit) result.push(itemUnit);
      }
    }
    if (node.type === "table") {
      const group = `t:${position.start.offset}`;
      // remark-gfm represents the delimiter row outside table.children.  The
      // first child is the header, so only body rows are independently movable.
      (node.children ?? []).slice(1).forEach(row => {
        const rowPosition = row.position;
        if (!rowPosition || row.type !== "tableRow") return;
        const rowUnit = unit(row, `t:${position.start.offset}:${rowPosition.start.offset}`, group);
        if (rowUnit) result.push(rowUnit);
      });
    }
  }
  return result;
}

export function collectPreviewMoveUnits(markdown: string): PreviewMoveUnit[] {
  return collectLocatedUnits(markdown).map(({ start: _start, end: _end, ...value }) => value);
}

function lineEnding(markdown: string): string {
  const match = markdown.match(/\r\n|\n|\r/);
  return match?.[0] ?? "\n";
}

function fallbackGap(group: string, markdown: string): string {
  const eol = lineEnding(markdown);
  return group.startsWith("root:") ? eol + eol : eol;
}

function rootSafeGap(gap: string, markdown: string): string {
  const endings = gap.match(/\r\n|\n|\r/g) ?? [];
  // A single physical line is enough for some original Markdown pairs (for
  // example heading + paragraph), but is not safe after arbitrary reordering.
  // Keep the slot and its existing line-ending style, then add one blank line.
  return endings.length >= 2 ? gap : gap + (endings[0] ?? lineEnding(markdown));
}

/**
 * Moves source slices rather than serializing an AST.  This intentionally
 * retains user spacing, line endings and all syntax inside the selected unit.
 */
export function movePreviewUnit(markdown: string, unitId: string, targetId: string, placement: "before" | "after"): string {
  if (unitId === targetId) return markdown;
  const all = collectLocatedUnits(markdown);
  const source = all.find(item => item.id === unitId);
  const target = all.find(item => item.id === targetId);
  if (!source || !target || source.group !== target.group) return markdown;

  const units = all.filter(item => item.group === source.group).sort((a, b) => a.start - b.start);
  if (units.length < 2) return markdown;
  const sourceIndex = units.findIndex(item => item.id === source.id);
  const targetIndex = units.findIndex(item => item.id === target.id);
  if (sourceIndex < 0 || targetIndex < 0) return markdown;

  const reordered = units.filter(item => item.id !== source.id);
  const targetAfterRemoval = reordered.findIndex(item => item.id === target.id);
  reordered.splice(targetAfterRemoval + (placement === "after" ? 1 : 0), 0, source);
  if (reordered.every((item, index) => item.id === units[index].id)) return markdown;

  const first = units[0];
  const last = units[units.length - 1];
  // Gaps belong to physical source slots, not to a moved unit.  Keeping them
  // at their slots preserves final-newline behavior and mixed EOL sequences.
  const replacement = reordered.map((item, index) => {
    if (index === reordered.length - 1) return markdown.slice(item.start, item.end);
    const slotGap = markdown.slice(units[index].end, units[index + 1].start) || fallbackGap(item.group, markdown);
    const gap = item.group.startsWith("root:") ? rootSafeGap(slotGap, markdown) : slotGap;
    return markdown.slice(item.start, item.end) + gap;
  }).join("");
  return markdown.slice(0, first.start) + replacement + markdown.slice(last.end);
}
