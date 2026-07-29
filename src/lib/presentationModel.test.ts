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
    expect(model.pages[0].isNavigationPage).toBe(true);
    expect(model.pages[0].markdown).not.toContain("line 1");
  });

  it("never merges when a parent has multiple direct children", () => {
    const model = buildPresentationModel("# Parent\n\n## One\nshort\n\n## Two\nshort", 10);

    expect(model.pages.map((page) => page.title)).toEqual(["Parent", "One", "Two"]);
    expect(model.pages[0].childIds).toEqual(["one", "two"]);
    expect(model.pages[0].isNavigationPage).toBe(true);
    expect(model.pages[0].markdown).not.toContain("short");
  });

  it.each([9, 10])("merges an only child with %s logical source lines", (lineCount) => {
    const body = Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`).join("\n");
    const model = buildPresentationModel(`# Parent\n\n## Child\n${body}`, 10);
    expect(model.pages.map((page) => page.id)).toEqual(["parent"]);
    expect(model.pages[0].markdown).toContain(`line ${lineCount}`);
  });

  it("keeps an 11-line only child separate and makes the parent a navigation page", () => {
    const body = Array.from({ length: 11 }, (_, index) => `line ${index + 1}`).join("\n");
    const model = buildPresentationModel(`# Parent\nparent body\n\n## Child\n${body}`, 10);
    expect(model.pages.map((page) => page.id)).toEqual(["parent", "child"]);
    expect(model.pages[0].markdown).not.toContain("parent body");
  });

  it("uses shared normalized IDs for repeated and skipped-level headings", () => {
    const model = buildPresentationModel("# ① Same\n\n### 1 Same\nchild\n\n# ① Same", 0);
    expect(model.pages.map((page) => page.id)).toEqual(["1-same", "1-same-2", "1-same-3"]);
    expect(model.pages[1].breadcrumbs.map((crumb) => crumb.id)).toEqual(["1-same", "1-same-2"]);
  });

  it("copies reference definitions to every Markdown fragment", () => {
    const model = buildPresentationModel("# First\n![sample][logo]\n\n# Second\ntext\n\n[logo]: images/logo.png \"Logo\"", 0);
    expect(model.pages).toHaveLength(2);
    expect(model.pages[0].markdown).toContain('[logo]: images/logo.png "Logo"');
    expect(model.pages[1].markdown).toContain('[logo]: images/logo.png "Logo"');
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
