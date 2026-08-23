import { describe, expect, it } from "vitest";
import { markdownForPreviewRange, previewSourceRangeEnd } from "./previewContext";

describe("preview context source ranges", () => {
  it("ends a block immediately before the next anchored source line", () => {
    expect(previewSourceRangeEnd([1, 4, 8], 4, 10)).toBe(7);
    expect(previewSourceRangeEnd([1, 4, 8], 8, 10)).toBe(10);
  });

  it("copies the original Markdown across selected preview blocks", () => {
    const content = "# title\r\n\r\nfirst line\r\ncontinued\r\n\r\n- item\r\n  detail\r\nend";
    expect(markdownForPreviewRange(content, [1, 3, 6, 8], 3)).toBe("first line\r\ncontinued\r\n");
    expect(markdownForPreviewRange(content, [1, 3, 6, 8], 3, 6)).toBe("first line\r\ncontinued\r\n\r\n- item\r\n  detail");
  });
});
