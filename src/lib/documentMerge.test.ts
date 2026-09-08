import { describe, expect, it } from "vitest";
import { adoptMergeResult, adoptMergeRow, buildMergeRows, mergeLines, rowDecision, unresolvedMergeRows } from "./documentMerge";

describe("行単位の両側採用", () => {
  it.each([
    ["a\nb\nc", "a\nS\nc", "a\nL\nc"],
    ["a\nb", "x\na\nb", "a\nb\ny"],
    ["a\nb\nc", "a\nc", "a\nedit\nc"],
    ["a\nb", "x\ny\nz", "a\nlocal"],
    ["同じ\n同じ\n末尾\n", "同じ\n変更\n末尾\n", "追加\n同じ\n同じ\n末尾\n"],
    ["", "追加\n", "自分"],
    ["a\r\nb\r\n", "a\r\nS\r\n", "a\r\nL\r\n"],
    ["a\rb\r", "a\rS\r", "a\rL\r"],
  ])("追加・削除・置換・反復行を欠落なく整列する: %s", (base, storage, local) => {
    const rows = buildMergeRows(base, storage, local, local);
    for (const [column, content] of [["storage", storage], ["local", local], ["result", local]] as const) {
      expect(rows.flatMap((row) => row[column] ? [row[column]!.text] : [])).toEqual(mergeLines(content));
    }
    let result = local;
    for (let i = 0; i < 100; i++) {
      const current = buildMergeRows(base, storage, local, result);
      const changed = current.find((row) => row.result?.text !== row.storage?.text);
      if (!changed) break;
      const next = adoptMergeRow(result, current, changed.id, "storage");
      expect(next).not.toBe(result);
      result = next;
    }
    expect(mergeLines(result)).toEqual(mergeLines(storage));
    if (local.includes("\r\n")) expect(result).not.toMatch(/(?<!\r)\n/);
  });
  it("1行だけ採用し、他の自分の変更を消さない", () => {
    const rows = buildMergeRows("a\nb\nc", "S\nb\nT", "a\nL\nc", "a\nL\nc");
    expect(adoptMergeRow("a\nL\nc", rows, "base:0", "storage")).toBe("S\nL\nc");
  });
  it("同じ変更は未選択にしないが、異なる外部変更は明示選択を要求する", () => {
    const same = buildMergeRows("base", "same", "same", "same");
    expect(unresolvedMergeRows(same, {})).toBe(0);
    const [row] = buildMergeRows("base", "S", "L", "L");
    expect(rowDecision(row, {})).toBe("unresolved");
    expect(rowDecision(row, { [row.id]: { choice: "local", fingerprint: row.fingerprint, result: "L" } })).toBe("local");
    const [updated] = buildMergeRows("base", "S2", "L", "L");
    expect(rowDecision(updated, { [row.id]: { choice: "local", fingerprint: row.fingerprint, result: "L" } })).toBe("unresolved");
  });
  it("2万行の局所変更を一括置換へ粗くせず比較する", () => {
    const base = Array.from({ length: 20_000 }, (_, i) => `line ${i}`);
    const storage = [...base]; storage[10_000] = "external";
    const rows = buildMergeRows(base.join("\n"), storage.join("\n"), base.join("\n"), base.join("\n"));
    expect(rows.filter((row) => row.changed)).toHaveLength(1);
    expect(rows[10_000].storage?.text).toBe("external");
  });
  it("seed付き反復行・挿入・削除の各列を保持する", () => {
    let seed = 1431;
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed; };
    for (let sample = 0; sample < 100; sample++) {
      const base = Array.from({ length: 20 }, () => `行${random() % 7}`);
      const alter = () => { const rows = [...base]; for (let n = 0; n < 5; n++) rows.splice(random() % rows.length, random() % 3, `追加${random() % 5}`); return rows.join("\n"); };
      const storage = alter(), local = alter();
      const rows = buildMergeRows(base.join("\n"), storage, local, local);
      expect(rows.flatMap((row) => row.storage ? [row.storage.text] : [])).toEqual(mergeLines(storage));
      expect(rows.flatMap((row) => row.local ? [row.local.text] : [])).toEqual(mergeLines(local));
      // 並び替え・反復行でも、表示された相違行を順に採用して原文へ到達できる。
      for (const side of ["storage", "local"] as const) {
        let result = side === "storage" ? local : storage;
        let aligned = buildMergeRows(base.join("\n"), storage, local, result);
        for (let n = 0; n < 150; n++) {
          const difference = aligned.find((row) => row.result?.text !== row[side]?.text);
          if (!difference) break;
          const next = adoptMergeResult(result, aligned, difference.id, side);
          expect(next.content).not.toBe(result);
          result = next.content; aligned = next.rows;
        }
        expect(result).toBe(side === "storage" ? storage : local);
      }
    }
  });
});
