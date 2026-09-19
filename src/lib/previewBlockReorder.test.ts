import { describe, expect, it } from "vitest";
import { collectPreviewTableCellTargets, insertPreviewBlockAfter, movePreviewUnitIntoTableCell } from "./previewBlockReorder";

describe("preview block reorder into table cells", () => {
  it("inserts an empty block after the rendered source block", () => {
    expect(insertPreviewBlockAfter("# A\n\n本文\n\n# B\n", 3)).toBe("# A\n\n本文\n\n\n# B\n");
    expect(insertPreviewBlockAfter("```\ncode\n```\n\n本文", 2)).toBe("```\ncode\n```\n\n\n本文");
  });
  it("collects body-cell drop targets", () => {
    const source = "画像の説明\n\n| 名前 | 内容 |\n| --- | --- |\n| A | B |";
    expect(collectPreviewTableCellTargets(source).map((target) => target.id)).toEqual(["tc:7:0:0", "tc:7:0:1"]);
  });

  it("moves an inline-safe text or image paragraph into a cell and removes its source block", () => {
    const source = "画像 ![図](image.png)\n\n| 名前 | 内容 |\n| --- | --- |\n| A | B |";
    expect(movePreviewUnitIntoTableCell(source, "r:0", "tc:20:0:1")).toBe("| 名前 | 内容 |\n| --- | --- |\n| A | B<br>画像 ![図](image.png) |");
  });
});
