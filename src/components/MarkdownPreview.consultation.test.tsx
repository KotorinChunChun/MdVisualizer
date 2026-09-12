import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
vi.mock("./MermaidBlock", () => ({ MermaidBlock: () => <div>Mermaidの図</div> }));
afterEach(cleanup);
it("Mermaidの右クリックで元のコードブロック範囲を相談へ渡す", () => {
  const consult = vi.fn();
  const content = "前の文章\n\n```mermaid\nflowchart TD\nA-->B\n```\n\n後の文章";
  render(<MarkdownPreview content={content} baseDir="" imageVersions={{}} tabId="a" onCodexConsult={consult} />);
  fireEvent.contextMenu(screen.getByText("Mermaidの図"), { clientX: 20, clientY: 20 });
  fireEvent.click(screen.getByRole("menuitem", { name: "Codexに相談" }));
  const target = consult.mock.calls[0][0];
  expect(target.documentId).toBe("a");
  expect(content.slice(target.from, target.to)).toBe("```mermaid\nflowchart TD\nA-->B\n```");
});
it("段落を右クリックしたときに前後の段落を含めない", () => {
  const consult = vi.fn();
  render(<MarkdownPreview content={"最初\n\n対象の文章\n\n最後"} baseDir="" imageVersions={{}} tabId="a" onCodexConsult={consult} />);
  fireEvent.contextMenu(screen.getByText("対象の文章"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Codexに相談" }));
  const target = consult.mock.calls[0][0];
  expect(target.content.slice(target.from, target.to)).toBe("対象の文章");
});
