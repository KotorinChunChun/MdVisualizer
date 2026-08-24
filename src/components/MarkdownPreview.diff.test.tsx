import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview diff highlighting", () => {
  it("marks rendered blocks that intersect changed source lines", () => {
    const { container } = render(
      <MarkdownPreview
        content={"# Heading\n\nunchanged\n\nchanged paragraph"}
        baseDir="C:\\docs"
        imageVersions={{}}
        mermaidMode="always-code"
        diffChangedLines={new Set([5])}
      />,
    );

    const changed = container.querySelectorAll(".markdown-diff-line");
    expect(changed).toHaveLength(1);
    expect(changed[0].textContent).toContain("changed paragraph");
  });

  it("keeps interactive diagram renderers disabled in static diff mode", () => {
    const { container } = render(
      <MarkdownPreview
        content={"```mermaid\nflowchart LR\nA --> B\n```\n\n```drawio\n<mxfile/>\n```"}
        baseDir="C:\\docs"
        imageVersions={{}}
        staticMode
      />,
    );

    expect(container.querySelector(".mermaid-container")).toBeNull();
    expect(container.querySelector(".drawio-block")).toBeNull();
    expect(container.textContent).toContain("flowchart LR");
    expect(container.textContent).toContain("<mxfile/>");
  });

  it("adds source-line anchors to individual table rows", () => {
    const { container } = render(
      <MarkdownPreview
        content={"| name | value |\n| --- | --- |\n| first | 1 |\n| second | 2 |"}
        baseDir="C:\\docs"
        imageVersions={{}}
      />,
    );

    expect([...container.querySelectorAll("tr")].map((row) => row.getAttribute("data-source-line"))).toEqual(["1", "3", "4"]);
  });
});
