import { describe, expect, it } from "vitest";
import { foldIdsForElement, headingIdForSourceLine, nearestRenderedSourceBlock, normalizeSourceLines, sourceLineAtTextOffset } from "./sourceNavigation";

describe("source navigation", () => {
  it("normalizes LF and CRLF without changing source line numbers", () => {
    expect(normalizeSourceLines("a\r\nb\nc\r")).toEqual(["a", "b", "c", ""]);
  });

  it("resolves the preceding heading section for body lines", () => {
    expect(headingIdForSourceLine([{ id: "one", line: 1 }, { id: "two", line: 8 }], 6)).toBe("one");
    expect(headingIdForSourceLine([{ id: "one", line: 1 }, { id: "two", line: 8 }], 8)).toBe("two");
    expect(headingIdForSourceLine([{ id: "one", line: 1 }], 0)).toBeNull();
  });

  it("chooses the nearest rendered block and keeps duplicate text independent", () => {
    const blocks = [{ line: 2, id: "a" }, { line: 7, id: "b" }, { line: 12, id: "c" }];
    expect(nearestRenderedSourceBlock(blocks, 9)?.id).toBe("b");
    expect(nearestRenderedSourceBlock(blocks, 1)?.id).toBe("a");
  });

  it("returns nested fold ancestors from the rendered anchor", () => {
    document.body.innerHTML = `<section data-fold-id="outer"><div><section data-fold-id="inner"><p id="target" data-source-line="4" data-block-id="block">text</p></section></div></section>`;
    const target = document.getElementById("target");
    expect(foldIdsForElement(target)).toEqual(["inner", "outer"]);
  });

  it("maps offsets to one-based source positions", () => {
    expect(sourceLineAtTextOffset("a\r\nb\nc", 5)).toEqual({ line: 3, column: 1 });
  });
});
