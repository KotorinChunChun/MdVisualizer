import { describe, expect, it } from "vitest";
import { __test__ } from "./foldSections";
import { ancestorFoldIds, collapsedForFoldCommand, resolveFoldToggle } from "./foldSections";

const heading = (level: number, text: string) => ({ type: "element", tagName: `h${level}`, children: [{ type: "text", value: text }] });

describe("fold sections", () => {
  it("nests subordinate headings inside their parent section", () => {
    const result = __test__.foldRange([heading(1, "A"), { type: "element", tagName: "p" }, heading(2, "B"), heading(1, "C")]);
    expect(result).toHaveLength(2);
    expect(result[0].tagName).toBe("section");
    expect(result[0].children?.[1].children).toHaveLength(2);
    expect(result[0].children?.[1].children?.[1].tagName).toBe("section");
    expect(result[0].properties?.["data-fold-id"]).toBe("a");
  });

  it("makes repeated headings distinct while keeping their stable slug", () => {
    const result = __test__.foldRange([heading(2, "Same"), heading(2, "Same")]);
    expect(result.map((section) => section.properties?.["data-fold-id"])).toEqual(["same", "same-2"]);
  });

  it("uses the same NFKC heading IDs as presentation pages", () => {
    const result = __test__.foldRange([heading(1, "① Overview"), heading(1, "1 Overview")]);
    expect(result.map((section) => section.properties?.["data-fold-id"])).toEqual(["1-overview", "1-overview-2"]);
  });

  it("finds every collapsed ancestor before restoring a nested heading", () => {
    const root = document.createElement("section");
    root.dataset.foldId = "root";
    const content = document.createElement("div");
    const child = document.createElement("section");
    child.dataset.foldId = "child";
    const target = document.createElement("section");
    target.dataset.foldId = "target";
    child.append(target);
    content.append(child);
    root.append(content);
    expect(ancestorFoldIds(target)).toEqual(["child", "root"]);
  });

  it("resolves whole-document toggle and level commands deterministically", () => {
    expect(resolveFoldToggle([false, true])).toBe("collapse");
    expect(resolveFoldToggle([true, true])).toBe("expand");
    expect(collapsedForFoldCommand("through-h2", 1, "top")).toBe(false);
    expect(collapsedForFoldCommand("through-h2", 3, "deep")).toBe(true);
    expect(collapsedForFoldCommand({ command: "except-current", currentFoldId: "here" }, 2, "here")).toBe(false);
    expect(collapsedForFoldCommand({ command: "except-current", currentFoldId: "here" }, 2, "there")).toBe(true);
  });
});
