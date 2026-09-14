import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
vi.mock("../features/codex/DiagramCodexAction", () => ({ DiagramCodexAction: ({ source, onSave }: { source: string; onSave: (text: string) => void }) => <button data-source={source} onClick={() => onSave('<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>')}>Codex図テスト</button> }));
afterEach(cleanup);
describe("SVGのCodexメニュー", () => {
  it("プレビュー限定でもホストが明示許可したブロック編集と表AIを表示する", () => {
    const onSave = vi.fn();
    render(<MarkdownPreview
      content={'```mermaid\nflowchart LR\nA --> B\n```\n\n```tsv\nname\tvalue\nA\t1\n```'}
      baseDir="C:/docs"
      documentPath="C:/docs/a.md"
      imageVersions={{}}
      readOnly
      allowBlockActions
      onCodeFenceBodyChange={onSave}
      onCodexConsult={vi.fn()}
    />);
    expect(screen.getByRole("button", { name: "Mermaid GUI編集" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "表を編集" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "AI表操作" })).toBeTruthy();
  });

  it("明示許可なしのreadOnlyではブロック編集を表示しない", () => {
    render(<MarkdownPreview content={'```mermaid\nflowchart LR\nA --> B\n```'} baseDir="C:/docs" documentPath="C:/docs/a.md" imageVersions={{}} readOnly onCodeFenceBodyChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Mermaid GUI編集" })).toBeNull();
  });

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
  it("プレビュー限定ではSVGの視覚編集を出さない", () => {
    render(<MarkdownPreview content={'```svg\n<svg/>\n```\n\n<svg/>'} baseDir="C:/docs" documentPath="C:/docs/a.md" imageVersions={{}} onInlineSvgChange={vi.fn()} onCodeFenceBodyChange={vi.fn()} readOnly />);
    expect(screen.queryByText("Codex図テスト")).toBeNull();
  });
});
