import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
vi.mock("../features/codex/DiagramCodexAction", () => ({ DiagramCodexAction: ({ source, onSave }: { source: string; onSave: (text: string) => void }) => <button data-source={source} onClick={() => onSave('<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>')}>Codex図テスト</button> }));
afterEach(cleanup);
describe("SVGのCodexメニュー", () => {
  it("SVGコードブロックの本文を対象にする", () => {
    const save = vi.fn();
    render(<MarkdownPreview content={'```svg\n<svg/>\n```'} baseDir="C:/docs" documentPath="C:/docs/a.md" imageVersions={{}} onCodeFenceBodyChange={save} />);
    fireEvent.click(screen.getByText("Codex図テスト"));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: "code-fence", language: "svg" }), expect.stringContaining("circle"));
  });
  it("2番目のインラインSVGだけを対象にする", () => {
    const save = vi.fn();
    const content = '<svg><rect width="1"/></svg>\n\n<svg><circle r="2"/></svg>';
    render(<MarkdownPreview content={content} baseDir="C:/docs" documentPath="C:/docs/a.md" imageVersions={{}} onInlineSvgChange={save} />);
    fireEvent.click(screen.getAllByText("Codex図テスト")[1]);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ start: content.lastIndexOf("<svg>"), kind: "inline-svg" }), expect.stringContaining("circle"));
  });
  it("静的プレビューではCodex操作を出さない", () => {
    render(<MarkdownPreview content={'```svg\n<svg/>\n```\n\n<svg/>'} baseDir="C:/docs" documentPath="C:/docs/a.md" imageVersions={{}} onInlineSvgChange={vi.fn()} onCodeFenceBodyChange={vi.fn()} staticMode />);
    expect(screen.queryByText("Codex図テスト")).toBeNull();
  });
});
