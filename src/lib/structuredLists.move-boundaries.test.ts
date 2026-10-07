import { describe, expect, it } from "vitest";
import { buildStructuredListMove } from "./markdownEditing";

const apply = (source: string, change: ReturnType<typeof buildStructuredListMove>) => change ? source.slice(0, change.from) + change.insert + source.slice(change.to) : source;

describe("番号項目移動の境界・継続本文・選択位置", () => {
  it.each([
    { source: "1. first\n本文\n2. second", needle: "first", direction: 1 as const },
    { source: "1. first\n\n段落\n\n2. second", needle: "second", direction: -1 as const },
    { source: "- bullet\n1. first", needle: "first", direction: -1 as const },
    { source: "1. first\n- bullet\n2. second", needle: "first", direction: 1 as const },
    { source: "1. first\n2) second", needle: "first", direction: 1 as const },
    { source: "- first\n+ second", needle: "second", direction: -1 as const },
    { source: "1. first\n\n 浅い通常段落\n\n2. second", needle: "second", direction: -1 as const },
    { source: "1. first\n\n 浅い通常段落\n\n2. second", needle: "first", direction: 1 as const },
  ])("隣接していない/別種リストを越えない: $source", ({ source, needle, direction }) => {
    expect(buildStructuredListMove(source, source.indexOf(needle), direction)).toBeNull();
  });
  it.each(["\n", "\r\n"])("継続段落と子項目を持つloose-listは上下移動で全文とカーソルを復元: %j", eol => {
    const source = ["1. first", "   継続本文", "   - 子項目", "", "2. second", "", "3. third", "", "段落"].join(eol);
    const down = buildStructuredListMove(source, source.indexOf("first") + 2, 1)!;
    const moved = apply(source, down);
    expect(moved).toBe(["1. second", "", "2. first", "   継続本文", "   - 子項目", "", "3. third", "", "段落"].join(eol));
    expect(down.anchor).toBe(moved.indexOf("first") + 2);
    const up = buildStructuredListMove(moved, down.anchor, -1)!;
    expect(apply(moved, up)).toBe(source); expect(up.anchor).toBe(source.indexOf("first") + 2);
  });
  it("字下げフェンスを上へ移動しても後続段落と末尾を変えない", () => {
    const source = "1. first\n\n2. second\n   ```text\n   1. code\n   ```\n\n段落\n";
    const change = buildStructuredListMove(source, source.indexOf("second"), -1)!;
    const moved = apply(source, change);
    expect(moved).toBe("1. second\n   ```text\n   1. code\n   ```\n\n2. first\n\n段落\n");
    expect(change.anchor).toBe(moved.indexOf("second"));
  });
});
