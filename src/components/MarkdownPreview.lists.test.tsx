import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

afterEach(cleanup);

describe("MarkdownPreview structured lists", () => {
  it("renders mixed two-space lists as separate nested items", () => {
    const content = [
      "1. asd",
      "  1. xxx",
      "    1. hoge",
      "     - asdasd",
      "       - asd",
      "         - asdads",
      "           - ads",
      "2. インデント0",
    ].join("\n");
    const { container } = render(<MarkdownPreview content={content} baseDir="" imageVersions={{}} />);
    const rootList = container.querySelector(".markdown-body > ol");
    expect(rootList?.querySelectorAll(":scope > li")).toHaveLength(2);
    expect(rootList?.querySelector(":scope > li > ol > li")?.textContent).toContain("xxx");
    expect(rootList?.querySelector(":scope > li > ol > li > ol > li")?.textContent).toContain("hoge");
    expect(container.textContent).not.toContain("xxx 1. hoge");
  });

  it("alternates unordered markers by overall indentation depth", () => {
    const content = "1. one\n  1. two\n    1. three\n     - odd\n       - even\n         - odd again";
    const { container } = render(<MarkdownPreview content={content} baseDir="" imageVersions={{}} />);
    const bullets = [...container.querySelectorAll("ul")];
    expect(bullets.map(list => list.className)).toEqual([
      "markdown-list-marker-odd",
      "markdown-list-marker-even",
      "markdown-list-marker-odd",
    ]);
  });

  it("keeps standard three-space ordered children nested", () => {
    const content = "1. 親A\n   1. 子A-1\n   2. 子A-2\n2. 親B\n   1. 子B-1";
    const { container } = render(<MarkdownPreview content={content} baseDir="" imageVersions={{}} />);
    const root = container.querySelector(".markdown-body > ol");
    expect(root?.querySelectorAll(":scope > li")).toHaveLength(2);
    expect(root?.querySelectorAll(":scope > li:first-child > ol > li")).toHaveLength(2);
    expect(container.textContent).not.toContain("親A 1. 子A-1");
  });
});
