import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview code fences", () => {
  afterEach(cleanup);

  it("shows the copy action for a fenced block without a language", () => {
    render(<MarkdownPreview content={"```\nplain text\n```"} baseDir="C:\\docs" imageVersions={{}} />);
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.getByText("plain text")).toBeTruthy();
  });

  it("renders SVG fences only when a read-only diff preview requests it", () => {
    const source = "```svg\n<svg xmlns=\"http://www.w3.org/2000/svg\"><text>図</text><script>bad()</script></svg>\n```";
    const view = render(<MarkdownPreview content={source} baseDir="" imageVersions={{}} />);
    expect(view.container.querySelector(".markdown-svg-fence-preview")).toBeNull();
    view.rerender(<MarkdownPreview content={source} baseDir="" imageVersions={{}} renderSvgFences />);
    const preview = screen.getByRole("img", { name: "SVG図のプレビュー" });
    expect(preview.textContent).toContain("図");
    expect(preview.querySelector("script")).toBeNull();
  });
});
