import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

vi.mock("./ImageRenderer", () => ({ ImageRenderer: () => null }));

describe("MarkdownPreview sanitization", () => {
  it("renders safe HTML and removes scripts, event handlers, and unsafe URLs", () => {
    const { container } = render(<MarkdownPreview content={'<strong>safe</strong><script>window.bad=true</script><a href="javascript:alert(1)" onclick="bad()">bad</a><a href="https://example.com">good</a>'} baseDir="" imageVersions={{}} onStartCrop={() => {}} />);
    expect(screen.getByText("safe").tagName).toBe("STRONG");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(screen.getByText("bad").getAttribute("href")).toBeNull();
    expect(screen.getByText("good").getAttribute("href")).toBe("https://example.com");
  });
});
