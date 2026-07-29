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
});
