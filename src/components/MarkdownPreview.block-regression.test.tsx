import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
vi.mock("./MermaidBlock", () => ({ MermaidBlock: ({ editable, source }: { editable?: boolean; source: string }) => <div data-testid="mermaid-preview" data-editable={String(Boolean(editable))}>{source}</div> }));
afterEach(cleanup);
const table = "| Name | Link |\n| --- | --- |\n| **Alpha** | [First](https://example.test/first) |\n| Beta | [Second](https://example.test/second) |";
describe("ブロックの閲覧専用と表操作", () => {
  it("プレビュー限定でもMermaidを描画し、編集は提供しない", () => {
    render(<MarkdownPreview content={'```mermaid\ngraph TD; A-->B\n```'} documentPath="sample.md" readOnly baseDir="" imageVersions={{}} onCodeFenceBodyChange={vi.fn()} />);
    expect(screen.getByTestId("mermaid-preview").getAttribute("data-editable")).toBe("false");
  });
  it("実際のMarkdown表を絞り込んでもリンク・太字と列を保持する", () => {
    render(<MarkdownPreview content={table} documentPath="sample.md" readOnly baseDir="" imageVersions={{}} />);
    const region = screen.getByRole("region", { name: "Markdown表" });
    expect(within(region).getByText("Alpha").tagName).toBe("STRONG");
    expect(within(region).getAllByRole("columnheader")).toHaveLength(2);
    fireEvent.change(within(region).getByRole("searchbox"), { target: { value: "Alpha" } });
    expect(within(region).getByRole("link", { name: "First" }).getAttribute("href")).toBe("https://example.test/first");
    expect(within(region).queryByRole("link", { name: "Second" })).toBeNull();
    expect(within(region).queryByRole("button", { name: "表を編集" })).toBeNull();
  });
});
