import { describe, expect, it } from "vitest";
import { PreviewEditHistory, replaceDocumentText } from "./documentTextEdit";
describe("閲覧中の文書更新", () => {
  const current = { documentId: "a:2", content: "## 題名\r\n\r\n本文", from: 0, to: 11 };
  it("元文書の記号とCRLFを保持して範囲だけ置換する", () => {
    expect(replaceDocumentText(current, { ...current, from: 3, to: 5 }, "変更")).toBe("## 変更\r\n\r\n本文");
  });
  it("世代・本文・不正範囲が変わった提案を適用しない", () => {
    expect(replaceDocumentText(current, { ...current, documentId: "a:1" }, "破壊")).toBeNull();
    expect(replaceDocumentText(current, { ...current, content: "違う" }, "破壊")).toBeNull();
    expect(replaceDocumentText(current, { ...current, from: -1 }, "破壊")).toBeNull();
    expect(replaceDocumentText(current, { ...current, from: 4, to: 3 }, "破壊")).toBeNull();
  });
  it("直接編集のUndo/Redoは別の編集や世代を上書きしない", () => {
    const history = new PreviewEditHistory();
    history.record("a:2", "元", "変更");
    expect(history.restore("a:2", "外部変更")).toBeNull();
    expect(history.restore("a:3", "変更")).toBeNull();
    expect(history.restore("a:2", "変更")).toBe("元");
    expect(history.restore("a:2", "元", true)).toBe("変更");
    history.record("a:2", "変更", "次");
    expect(history.restore("a:2", "次", true)).toBeNull();
  });
});
