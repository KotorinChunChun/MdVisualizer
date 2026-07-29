import { describe, expect, it } from "vitest";
import { captureScrollAnchor, restoreScrollAnchor } from "./scrollAnchor";

function rect(top: number, bottom = top + 20): DOMRect {
  return { top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON() {} };
}

describe("semantic scroll anchor", () => {
  it("restores the same text block after content is inserted before it", () => {
    const container = document.createElement("main");
    const root = document.createElement("div");
    const target = document.createElement("p");
    target.dataset.blockId = "chapter:p:target:1";
    target.dataset.blockFoldId = "chapter";
    target.textContent = "Target text";
    root.append(target);
    container.append(root);
    document.body.append(container);
    Object.defineProperties(container, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 1000 },
    });
    container.scrollTop = 300;
    container.getBoundingClientRect = () => rect(100, 300);
    target.getBoundingClientRect = () => rect(120, 140);
    target.getClientRects = () => [rect(120, 140)] as unknown as DOMRectList;
    const anchor = captureScrollAnchor(container, root)!;

    container.scrollTop = 300;
    target.getBoundingClientRect = () => rect(260, 280);
    expect(restoreScrollAnchor(container, root, anchor)).toBe("block");
    expect(container.scrollTop).toBe(440);
    container.remove();
  });

  it("falls back to the saved ratio when the block no longer exists", () => {
    const container = document.createElement("main");
    const root = document.createElement("div");
    Object.defineProperties(container, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 1200 },
    });
    container.scrollTop = 0;
    const mode = restoreScrollAnchor(container, root, {
      blockId: "missing",
      foldId: "",
      text: "gone",
      sourceLine: null,
      viewportOffset: 0,
      scrollRatio: 0.4,
    });
    expect(mode).toBe("ratio");
    expect(container.scrollTop).toBe(400);
  });

  it("chooses the first matching duplicate inside the saved fold deterministically", () => {
    const container = document.createElement("main");
    const root = document.createElement("div");
    const outside = document.createElement("p");
    const first = document.createElement("p");
    const second = document.createElement("p");
    for (const [element, fold, top] of [[outside, "other", 20], [first, "saved", 100], [second, "saved", 180]] as const) {
      element.dataset.blockId = `new-${top}`;
      element.dataset.blockFoldId = fold;
      element.textContent = "Repeated text";
      element.getBoundingClientRect = () => rect(top);
      element.getClientRects = () => [rect(top)] as unknown as DOMRectList;
      root.append(element);
    }
    container.append(root);
    document.body.append(container);
    Object.defineProperties(container, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 1000 },
    });
    container.getBoundingClientRect = () => rect(0, 200);
    container.scrollTop = 50;
    restoreScrollAnchor(container, root, {
      blockId: "removed",
      foldId: "saved",
      text: "repeated text",
      sourceLine: 20,
      viewportOffset: 10,
      scrollRatio: 0.5,
    });
    expect(container.scrollTop).toBe(140);
    container.remove();
  });

  it("falls back to the closest preceding source line before using ratio", () => {
    const container = document.createElement("main");
    const root = document.createElement("div");
    const line20 = document.createElement("p");
    const line40 = document.createElement("p");
    for (const [element, line, top] of [[line20, 20, 80], [line40, 40, 160]] as const) {
      element.dataset.blockId = `line-${line}`;
      element.dataset.sourceLine = String(line);
      element.getBoundingClientRect = () => rect(top);
      element.getClientRects = () => [rect(top)] as unknown as DOMRectList;
      root.append(element);
    }
    container.append(root);
    container.getBoundingClientRect = () => rect(20, 220);
    expect(restoreScrollAnchor(container, root, {
      blockId: "removed",
      foldId: "",
      text: "",
      sourceLine: 35,
      viewportOffset: 0,
      scrollRatio: 0.9,
    })).toBe("line");
    expect(container.scrollTop).toBe(60);
  });
});
