import { describe, expect, it } from "vitest";
import { buildPresentationModel } from "./presentationModel";

describe("buildPresentationModel", () => {
  it("merges the only short direct child into its parent", () => {
    const model = buildPresentationModel("# Parent\nIntro\n\n## Only child\nshort\nbody", 10);

    expect(model.pages.map((page) => page.title)).toEqual(["Parent"]);
    expect(model.pages[0].markdown).toContain("## Only child");
    expect(model.pages[0].mergedChildId).toBe("only-child");
  });

  it("keeps an only child with more than the source-line threshold as a page", () => {
    const body = Array.from({ length: 11 }, (_, index) => `line ${index + 1}`).join("\n");
    const model = buildPresentationModel(`# Parent\n\n## Long child\n${body}`, 10);

    expect(model.pages.map((page) => page.title)).toEqual(["Parent", "Long child"]);
    expect(model.pages[0].childIds).toEqual(["long-child"]);
  });

  it("never merges when a parent has multiple direct children", () => {
    const model = buildPresentationModel("# Parent\n\n## One\nshort\n\n## Two\nshort", 10);

    expect(model.pages.map((page) => page.title)).toEqual(["Parent", "One", "Two"]);
    expect(model.pages[0].childIds).toEqual(["one", "two"]);
  });

  it("builds unlimited breadcrumbs with sibling positions", () => {
    const model = buildPresentationModel("# A\nbody\n\n## B1\nbody\n\n## B2\nbody\n\n### C\nbody\n\n#### D\nbody\n\n##### E\nbody\n\n###### F\nbody", 0);
    const page = model.pages.find((candidate) => candidate.title === "F");

    expect(page?.breadcrumbs.map((crumb) => `${crumb.title} (${crumb.index}/${crumb.total})`))
      .toEqual(["A (1/1)", "B2 (2/2)", "C (1/1)", "D (1/1)", "E (1/1)", "F (1/1)"]);
  });

  it("keeps heading-free documents usable as one page", () => {
    const model = buildPresentationModel("plain text");
    expect(model.pages).toHaveLength(1);
    expect(model.pages[0].markdown).toBe("plain text");
  });
});
