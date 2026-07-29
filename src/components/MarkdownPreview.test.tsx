import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { countMermaidFences, MarkdownPreview } from "./MarkdownPreview";
import { openExternalUrl } from "../lib/commands";

vi.mock("./ImageRenderer", () => ({ ImageRenderer: () => null }));
vi.mock("../lib/commands", () => ({ openExternalUrl: vi.fn() }));

describe("MarkdownPreview sanitization", () => {
  it("renders safe HTML and removes scripts, event handlers, and unsafe URLs", () => {
    const { container } = render(<MarkdownPreview content={'<strong>safe</strong><script>window.bad=true</script><a href="javascript:alert(1)" onclick="bad()">bad</a><a href="https://example.com">good</a>'} baseDir="" imageVersions={{}} onStartCrop={() => {}} />);
    expect(screen.getByText("safe").tagName).toBe("STRONG");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
    expect(screen.getByText("bad").getAttribute("href")).toBeNull();
    expect(screen.getByText("good").getAttribute("href")).toBe("https://example.com");
  });

  it("makes rendered headings collapsible with their preserved fold id", () => {
    render(<MarkdownPreview content={"# Heading\n\nBody"} baseDir="" imageVersions={{}} onStartCrop={() => {}} />);
    const button = screen.getByRole("button", { name: /Heading/ });
    expect(button.closest("section")?.dataset.foldId).toBe("heading");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Body").closest("section")?.querySelector(":scope > .fold-content")?.hasAttribute("hidden")).toBe(true);
  });

  it("opens a relative Markdown link in the app instead of the external URL handler", () => {
    const onOpenDocument = vi.fn();
    render(<MarkdownPreview content="[next](../guide/next.md)" baseDir="C:\\docs\\current" imageVersions={{}} onStartCrop={() => {}} onOpenDocument={onOpenDocument} />);
    fireEvent.click(screen.getByRole("link", { name: "next" }));
    expect(onOpenDocument).toHaveBeenCalledWith("C:/docs/guide/next.md");
    expect(openExternalUrl).not.toHaveBeenCalled();
  });
});

describe("countMermaidFences", () => {
  it("counts both backtick and tilde Mermaid fences", () => {
    expect(countMermaidFences("```mermaid\ngraph TD\n```\n\n~~~Mermaid title\ngraph TD\n~~~")).toBe(2);
  });

  it("does not count Mermaid-looking lines inside another fenced block", () => {
    expect(countMermaidFences("```text\n~~~mermaid\ngraph TD\n~~~\n```\n\n```mermaid\ngraph TD\n```"))
      .toBe(1);
  });

  it("requires a matching closing fence before interpreting later fence-like lines", () => {
    expect(countMermaidFences("````text\n```mermaid\ngraph TD\n```\n````\n\n~~~mermaid\ngraph TD\n~~~~"))
      .toBe(1);
  });

  it("counts Mermaid fences in block quotes", () => {
    expect(countMermaidFences("> ```mermaid\n> graph TD\n> ```")).toBe(1);
  });

  it("counts Mermaid fences in list items", () => {
    expect(countMermaidFences("- Diagram\n\n  ```mermaid\n  graph TD\n  ```")).toBe(1);
  });

  it("counts nested quote and list Mermaid fences", () => {
    expect(countMermaidFences("> - Diagram\n>\n>   ~~~mermaid\n>   graph TD\n>   ~~~")).toBe(1);
  });

  it("does not count Mermaid-looking content in a non-Mermaid fenced block", () => {
    expect(countMermaidFences("> ```text\n> ```mermaid\n> ```\n> ```")).toBe(0);
  });

  it("does not count an indented code block that only looks like a Mermaid fence", () => {
    expect(countMermaidFences("    ```mermaid\n    graph TD\n    ```")).toBe(0);
  });
});
