import { describe, expect, it } from "vitest";
import { __test__ } from "./foldSections";

const heading = (level: number, text: string) => ({ type: "element", tagName: `h${level}`, children: [{ type: "text", value: text }] });

describe("fold sections", () => {
  it("nests subordinate headings inside their parent section", () => {
    const result = __test__.foldRange([heading(1, "A"), { type: "element", tagName: "p" }, heading(2, "B"), heading(1, "C")]);
    expect(result).toHaveLength(2);
    expect(result[0].tagName).toBe("section");
    expect(result[0].children?.[1].children).toHaveLength(2);
    expect(result[0].children?.[1].children?.[1].tagName).toBe("section");
  });
});
