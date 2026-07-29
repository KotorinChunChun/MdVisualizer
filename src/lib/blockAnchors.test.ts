import { describe, expect, it } from "vitest";
import { __test__, normalizeAnchorText } from "./blockAnchors";

describe("block anchors", () => {
  it("keeps a paragraph id stable when unrelated content is inserted before it", () => {
    const makeTree = (prefix: boolean) => ({
      type: "root",
      children: [
        ...(prefix ? [{ type: "element", tagName: "p", children: [{ type: "text", value: "new" }] }] : []),
        {
          type: "element",
          tagName: "section",
          properties: { "data-fold-id": "chapter" },
          children: [{ type: "element", tagName: "p", children: [{ type: "text", value: "Target text" }] }],
        },
      ],
    });
    const before = makeTree(false);
    const after = makeTree(true);
    __test__.assignBlockAnchors(before, "root", new Map());
    __test__.assignBlockAnchors(after, "root", new Map());
    const beforeId = (before.children[0].children?.[0] as { properties?: Record<string, unknown> }).properties?.["data-block-id"];
    const afterId = (after.children[1].children?.[0] as { properties?: Record<string, unknown> }).properties?.["data-block-id"];
    expect(beforeId).toBe(afterId);
  });

  it("normalizes whitespace and case for text matching", () => {
    expect(normalizeAnchorText("  SAME\n text ")).toBe("same text");
  });
});
