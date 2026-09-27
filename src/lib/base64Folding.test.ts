import { describe, expect, it } from "vitest";
import { findBase64FoldRange, findBase64FoldRanges } from "./base64Folding";

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

  it("finds every long image in one table row", () => {
    const first = "A".repeat(80);
    const second = "B".repeat(96);
    const line = `| ![a](data:image/png;base64,${first}) | ![b](data:image/svg+xml;base64,${second}) |`;
    const ranges = findBase64FoldRanges(line);

    expect(ranges).toHaveLength(2);
    expect(line.slice(ranges[0].from, ranges[0].to)).toBe("A".repeat(52));
    expect(line.slice(ranges[1].from, ranges[1].to)).toBe("B".repeat(68));
  });
});
