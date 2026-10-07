import { describe, expect, it } from "vitest";
import { buildStructuredListMove } from "./markdownEditing";

interface AuditCase {
  id: string;
  description: string;
  source: string;
  needle: string;
  direction: -1 | 1;
  expected: string;
}

function apply(source: string, change: { from: number; to: number; insert: string } | null): string {
  return change ? source.slice(0, change.from) + change.insert + source.slice(change.to) : source;
}

const NUMBERED_LIST_MOVE_AUDIT_CASES: readonly AuditCase[] = [
  {
    id: "ordered-up-does-not-cross-paragraph",
    description: "無関係な段落を越えて番号項目を上へ移動しない",
    source: "1. first\n本文\n2. second",
    needle: "second",
    direction: -1,
    expected: "1. first\n本文\n2. second",
  },
  {
    id: "ordered-up-does-not-cross-bullet-list",
    description: "箇条書きとの境界を越えて番号項目を上へ移動しない",
    source: "1. first\n- bullet\n2. second",
    needle: "second",
    direction: -1,
    expected: "1. first\n- bullet\n2. second",
  },
  {
    id: "ordered-down-does-not-cross-bullet-list",
    description: "箇条書きとの境界を越えて番号項目を下へ移動しない",
    source: "1. first\n2. second\n- bullet",
    needle: "second",
    direction: 1,
    expected: "1. first\n2. second\n- bullet",
  },
  {
    id: "ordered-down-carries-continuation-paragraph",
    description: "番号項目直下のインデント段落を伴って下へ移動する",
    source: "1. first\n   continuation\n2. second",
    needle: "first",
    direction: 1,
    expected: "1. second\n2. first\n   continuation",
  },
  {
    id: "ordered-down-carries-fenced-code",
    description: "番号項目直下のコードフェンスを伴って下へ移動する",
    source: "1. first\n   ```text\n   code\n   ```\n2. second",
    needle: "first",
    direction: 1,
    expected: "1. second\n2. first\n   ```text\n   code\n   ```",
  },
  {
    id: "ordered-down-preserves-loose-list-separators",
    description: "空行で区切られた番号項目の間隔を保持して下へ移動する",
    source: "1. first\n\n2. second\n\n3. third",
    needle: "second",
    direction: 1,
    expected: "1. first\n\n2. third\n\n3. second",
  },
];

describe("番号付きリストAlt+上下移動の監査", () => {
  // 監査時に発見した6件を、修正後の通常回帰として維持する。
  it.each(NUMBERED_LIST_MOVE_AUDIT_CASES)("$id: $description", ({ source, needle, direction, expected }) => {
    const actual = apply(source, buildStructuredListMove(source, source.indexOf(needle), direction));
    expect(actual).toBe(expected);
  });
});
