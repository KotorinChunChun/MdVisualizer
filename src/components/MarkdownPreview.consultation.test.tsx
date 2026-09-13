import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

vi.mock("./MermaidBlock", () => ({ MermaidBlock: () => <div className="mermaid-container"><svg aria-label="Mermaid SVG"><circle cx="5" cy="5" r="4" /></svg><span>Mermaidの図</span></div> }));
vi.mock("./ExternalDrawioBlock", () => ({ ExternalDrawioBlock: () => <div className="drawio-block"><svg aria-label="draw.io SVG"><circle cx="5" cy="5" r="4" /></svg><span>draw.ioの図</span></div> }));

afterEach(cleanup);

function chooseSkill(label: string, consult: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
  const add = screen.queryByRole("menuitem", { name: "現在の会話に追加" }); if (add) fireEvent.click(add);
  return consult.mock.calls[consult.mock.calls.length - 1]?.[0];
}

describe("MarkdownPreview consultation context menu", () => {
  it("Mermaidの右クリックを図として扱い、解説・改善だけを表示してSVGを添付する", () => {
    const consult = vi.fn();
    const content = "前の文章\n\n```mermaid\nflowchart TD\nA-->B\n```\n\n後の文章";
    render(<MarkdownPreview content={content} baseDir="" imageVersions={{}} tabId="a" onCodexConsult={consult} />);
    fireEvent.contextMenu(screen.getByText("Mermaidの図"), { clientX: 20, clientY: 20 });

    expect(screen.getByRole("menuitem", { name: "AIで画像を解説" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "AIで見た目を改善" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "画像から文字起こし" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "AIで文字起こし（表）" })).toBeNull();
    const target = chooseSkill("AIで画像を解説", consult);
    expect(target.targetKind).toBe("mermaid");
    expect(target.renderedSvg).toContain("<svg");
    expect(content.slice(target.from, target.to)).toBe("```mermaid\nflowchart TD\nA-->B\n```");
  });

  it("draw.ioの右クリックを図として扱い、解説・改善だけを表示する", () => {
    const consult = vi.fn();
    const content = "前\n\n![構成図](diagram.drawio)\n\n後";
    render(<MarkdownPreview content={content} baseDir="C:/docs" documentPath="C:/docs/a.md" imageVersions={{}} tabId="a" onCodexConsult={consult} />);
    fireEvent.contextMenu(screen.getByText("draw.ioの図"), { clientX: 20, clientY: 20 });

    expect(screen.getByRole("menuitem", { name: "AIで画像を解説" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "AIで見た目を改善" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "画像から文字起こし" })).toBeNull();
    const target = chooseSkill("AIで見た目を改善", consult);
    expect(target.targetKind).toBe("drawio");
    expect(target.renderedSvg).toContain("<svg");
  });

  it("インラインSVGの右クリックをSVGとして扱い、OCRを表示しない", () => {
    const consult = vi.fn();
    const content = "<svg><circle cx=\"5\" cy=\"5\" r=\"4\" /></svg>";
    render(<MarkdownPreview content={content} baseDir="" documentPath="C:/docs/a.md" imageVersions={{}} tabId="a" onCodexConsult={consult} />);
    fireEvent.contextMenu(screen.getByRole("img", { name: "インラインSVG" }), { clientX: 20, clientY: 20 });

    expect(screen.getByRole("menuitem", { name: "AIで画像を解説" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "AIで見た目を改善" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "画像から文字起こし" })).toBeNull();
    const target = chooseSkill("AIで画像を解説", consult);
    expect(target.targetKind).toBe("svg");
    expect(target.renderedSvg).toContain("<svg");
  });

  it("連続した複数行選択は共通メニューから一意な範囲を渡す", () => {
    const consult = vi.fn();
    const content = "一行目\n\n二行目\n\n三行目\n\n最後";
    render(<MarkdownPreview content={content} baseDir="" imageVersions={{}} tabId="a" onCodexConsult={consult} />);
    const first = screen.getByText("一行目");
    const last = screen.getByText("三行目");
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(first.firstChild!, 0);
    range.setEnd(last.firstChild!, last.textContent?.length ?? 0);
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.contextMenu(screen.getByText("二行目"), { clientX: 20, clientY: 20 });

    const target = chooseSkill("AIに相談", consult);
    expect(content.slice(target.from, target.to)).toBe("一行目\n\n二行目\n\n三行目");
    expect(target.targetKind).toBe("text");
  });
});
