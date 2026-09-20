import { describe, expect, it } from "vitest";
import { foldIdsForElement, headingIdForSourceLine, nearestRenderedSourceBlock, normalizeSourceLines, presentationPageIdForSourceLine, scrollSourceTarget, sourceAnchorForLine, sourceLineAtTextOffset } from "./sourceNavigation";

describe("source navigation", () => {
  it.each([1, 2])("末尾見出しへの移動は本文の範囲内に収まり祖先を動かさない（zoom %s）", scale => {
    const outer = document.createElement("div");
    const container = document.createElement("main");
    const target = document.createElement("h2");
    outer.append(container); container.append(target);
    outer.scrollTop = 17;
    Object.defineProperties(container, { clientHeight: { value: 400 }, offsetHeight: { value: 400 }, scrollHeight: { value: 1000 } });
    container.getBoundingClientRect = () => new DOMRect(0, 100, 300, 400 * scale);
    target.getBoundingClientRect = () => new DOMRect(0, 100 + 920 * scale, 200, 30 * scale);
    expect(scrollSourceTarget(container, target, "start")).toBe(true);
    expect(container.scrollTop).toBe(600);
    expect(outer.scrollTop).toBe(17);
  });

  it("中央配置・先頭の上限と対象外の要素を扱う", () => {
    const container = document.createElement("main"), target = document.createElement("h2");
    container.append(target);
    Object.defineProperties(container, { clientHeight: { value: 400 }, offsetHeight: { value: 400 }, scrollHeight: { value: 1000 } });
    container.getBoundingClientRect = () => new DOMRect(0, 100, 300, 400);
    target.getBoundingClientRect = () => new DOMRect(0, 400, 200, 40);
    expect(scrollSourceTarget(container, target)).toBe(true);
    expect(container.scrollTop).toBe(120);
    target.getBoundingClientRect = () => new DOMRect(0, -200, 200, 40);
    scrollSourceTarget(container, target, "start");
    expect(container.scrollTop).toBe(0);
    expect(scrollSourceTarget(container, document.createElement("h2"))).toBe(false);
    expect(scrollSourceTarget(null, target)).toBe(false);
  });
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

  it("resolves a rendered source anchor and presentation page by source line", () => {
    document.body.innerHTML = `<div id="root"><section data-fold-id="heading"><p data-source-line="4" data-block-id="block">本文</p></section></div>`;
    const root = document.getElementById("root") as HTMLElement;
    expect(sourceAnchorForLine(root, 4, 3)).toMatchObject({ source: { line: 4, column: 3 }, headingId: "heading", blockId: "block" });
    expect(presentationPageIdForSourceLine([{ id: "one", sourceLine: 1 }, { id: "two", sourceLine: 8 }], 6)).toBe("one");
    expect(presentationPageIdForSourceLine([{ id: "one", sourceLine: 1 }, { id: "two", sourceLine: 8 }], 20)).toBe("two");
  });
});
