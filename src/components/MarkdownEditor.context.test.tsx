import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";

vi.mock("../features/codex/skills", () => ({
  useCodexSkills: () => [{ id: "consult", config: { label: "AIに相談", mode: "question" } }, { id: "edit", config: { label: "AIに修正を依頼", mode: "selection" } }],
  visibleSkills: (skills: unknown[]) => skills,
}));
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(cleanup);

describe("コード画面の統合右クリック", () => {
  it("共通のコピーとAIメニューを表示し、連続複数行の選択と文書世代を渡す", async () => {
    const onConsult = vi.fn();
    const content = "前\n対象1\n対象2\n後";
    const { container } = render(<MarkdownEditor documentId="tab-1:4" value={content} dirty={false} saving={false} onChange={vi.fn()} onSave={vi.fn()} onCodexConsult={onConsult} />);
    const editable = container.querySelector<HTMLElement>(".cm-content")!;
    const view = EditorView.findFromDOM(editable)!;
    act(() => view.dispatch({ selection: { anchor: 2, head: 9 } }));
    vi.spyOn(view, "posAtCoords").mockReturnValue(5);
    fireEvent.contextMenu(editable, { clientX: 30, clientY: 40 });
    for (const name of ["プレーンテキストでコピー", "コードをMarkdownでコピー"]) expect(screen.getByRole("menuitem", { name })).toBeTruthy();
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(screen.queryByRole("menuitem", { name: "アプリの設定を変更したい" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "元に戻す" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "やり直す" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "AIに相談" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "現在の会話に追加" }));
    await waitFor(() => expect(onConsult).toHaveBeenCalledWith(expect.objectContaining({ documentId: "tab-1:4", content, from: 2, to: 9, editMode: "question", conversationAction: "add" })));
  });

  it("AI連携がなくても共通のMarkdownコピーを表示する", () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const { container } = render(<MarkdownEditor documentId="tab-2:1" value="本文" dirty={false} saving={false} onChange={vi.fn()} onSave={vi.fn()} />);
    const editable = container.querySelector<HTMLElement>(".cm-content")!;
    const view = EditorView.findFromDOM(editable)!;
    vi.spyOn(view, "posAtCoords").mockReturnValue(0);
    fireEvent.contextMenu(editable);
    fireEvent.click(screen.getByRole("menuitem", { name: "コードをMarkdownでコピー" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('本文');
  });

  it.each([['![図](a.png)','埋め込みに変換'], ['![図](data:image/png;base64,AAAA)','ファイルへ変換']])("%sはコードとビジュアルで同じ項目と順序で同じ対象を変換する", (content, label) => {
    const convert = vi.fn();
    const preview = render(<MarkdownPreview content={content} documentPath="C:/docs/a.md" baseDir="C:/docs" imageVersions={{}} allowBlockActions onTargetStorageConvert={convert} onCodexConsult={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole('img', {name:'図'}));
    const expected = screen.getAllByRole('menuitem').map(item => item.textContent);
    fireEvent.click(screen.getByRole('menuitem',{name:label}));
    const visualTarget = convert.mock.calls[0][0];
    preview.unmount();
    const {container} = render(<MarkdownEditor documentId="doc" documentPath="C:/docs/a.md" baseDir="C:/docs" value={content} dirty={false} saving={false} onChange={vi.fn()} onSave={vi.fn()} onTargetStorageConvert={convert} onCodexConsult={vi.fn()} />);
    const editable=container.querySelector<HTMLElement>('.cm-content')!;
    const view=EditorView.findFromDOM(editable)!;
    vi.spyOn(view,'posAtCoords').mockReturnValue(3);
    fireEvent.contextMenu(editable);
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(expected);
    expect(screen.getAllByRole('separator')).toHaveLength(2);
    fireEvent.click(screen.getByRole('menuitem',{name:label}));
    expect(convert.mock.calls[1][0].occurrence).toEqual(visualTarget.occurrence);
  });
});
