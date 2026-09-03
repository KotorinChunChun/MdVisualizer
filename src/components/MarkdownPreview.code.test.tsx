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
});
