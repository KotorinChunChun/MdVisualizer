import { describe, expect, it } from "vitest";
import { findBase64FoldRange } from "./base64Folding";

describe("findBase64FoldRange", () => {
  it("hides the middle of a long raster data URI", () => {
    const body = "A".repeat(80);
    const line = `![image](data:image/png;base64,${body})`;
    const range = findBase64FoldRange(line, 100)!;

    expect(line.slice(range.from - 100, range.to - 100)).toBe("A".repeat(52));
  });

  it("ignores regular image paths and short data", () => {
    expect(findBase64FoldRange("![image](image.png)")).toBeNull();
    expect(findBase64FoldRange("data:image/png;base64,AAAA")).toBeNull();
  });
});
