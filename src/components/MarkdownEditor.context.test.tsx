import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { MarkdownEditor } from "./MarkdownEditor";

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
  it("標準編集とAIメニューを表示し、連続複数行の選択と文書世代を渡す", async () => {
    const onConsult = vi.fn();
    const content = "前\n対象1\n対象2\n後";
    const { container } = render(<MarkdownEditor documentId="tab-1:4" value={content} dirty={false} saving={false} onChange={vi.fn()} onSave={vi.fn()} onCodexConsult={onConsult} />);
    const editable = container.querySelector<HTMLElement>(".cm-content")!;
    const view = EditorView.findFromDOM(editable)!;
    act(() => view.dispatch({ selection: { anchor: 2, head: 9 } }));
    vi.spyOn(view, "posAtCoords").mockReturnValue(5);
    fireEvent.contextMenu(editable, { clientX: 30, clientY: 40 });
    for (const name of ["切り取り", "コピー", "貼り付け", "すべて選択"]) expect(screen.getByRole("menuitem", { name })).toBeTruthy();
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    expect(screen.queryByRole("menuitem", { name: "アプリの設定を変更したい" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "元に戻す" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "やり直す" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "AIに相談" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "現在の会話に追加" }));
    await waitFor(() => expect(onConsult).toHaveBeenCalledWith(expect.objectContaining({ documentId: "tab-1:4", content, from: 2, to: 9, editMode: "question", conversationAction: "add" })));
  });

  it("AI連携がなくても標準メニューからすべて選択できる", () => {
    const { container } = render(<MarkdownEditor documentId="tab-2:1" value="本文" dirty={false} saving={false} onChange={vi.fn()} onSave={vi.fn()} />);
    const editable = container.querySelector<HTMLElement>(".cm-content")!;
    const view = EditorView.findFromDOM(editable)!;
    vi.spyOn(view, "posAtCoords").mockReturnValue(0);
    fireEvent.contextMenu(editable);
    fireEvent.click(screen.getByRole("menuitem", { name: "すべて選択" }));
    expect(view.state.selection.main.to).toBe(2);
  });
});
