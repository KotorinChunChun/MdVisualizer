import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { copyRasterImage } from "../lib/imageActions";
import { replaceImageOccurrenceSource } from "../lib/assetConversion";
import type { CodexTarget } from "../features/codex/scope";

const configuration = vi.hoisted(() => ({ disabled: new Set<string>() }));
vi.mock("../features/codex/skills", async original => {
  const actual = await original<typeof import("../features/codex/skills")>();
  return { ...actual, useCodexSkills: () => actual.DEFAULT_SKILL_FILES.map(actual.parseSkill).map(skill => ({ ...skill, config: { ...skill.config, enabled: skill.config.enabled && !configuration.disabled.has(skill.id) } })) };
});
vi.mock("../lib/imageActions", async original => ({ ...await original<typeof import("../lib/imageActions")>(), copyRasterImage: vi.fn().mockResolvedValue(undefined) }));
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const documentPath = "C:/natural-cycle02/menus.md";
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
beforeEach(() => { configuration.disabled.clear(); Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); window.getSelection()?.removeAllRanges(); });

function code(content: string, convert = vi.fn(), stagedAssetPreviews = {}) {
  const changed = vi.fn();
  const props = { documentId: "menu-doc:1", documentPath, baseDir: "C:/natural-cycle02", stagedAssetPreviews, value: content, dirty: true, saving: false, onChange: changed, onSave: vi.fn(), onTargetStorageConvert: convert, onCodexConsult: vi.fn() };
  const view = render(<MarkdownEditor {...props} />);
  const editable = view.container.querySelector<HTMLElement>(".cm-content")!;
  const editor = EditorView.findFromDOM(editable)!;
  const position = vi.spyOn(editor, "posAtCoords");
  return { ...view, changed, editor, editable, open(offset: number) { position.mockReturnValue(offset); fireEvent.contextMenu(editable); }, refresh() { view.rerender(<MarkdownEditor {...props} onCodexConsult={vi.fn()} />); } };
}
function visual(content: string, convert = vi.fn(), stagedAssetPreviews = {}) {
  const props = { content, documentPath, baseDir: "C:/natural-cycle02", imageVersions: {}, allowBlockActions: true, onTargetStorageConvert: convert, onCodexConsult: vi.fn(), stagedAssetPreviews };
  const view = render(<MarkdownPreview {...props} />);
  return { ...view, refresh() { view.rerender(<MarkdownPreview {...props} onCodexConsult={vi.fn()} />); } };
}
const items = () => screen.getAllByRole("menuitem").map(item => item.textContent ?? "");
const close = () => fireEvent.keyDown(window, { key: "Escape" });
function convertImage(content: string, target: CodexTarget) {
  expect(target.occurrence?.kind).toBe("image");
  if (target.occurrence?.kind !== "image") throw new Error("画像対象が未解決");
  return replaceImageOccurrenceSource(content, target.occurrence, png);
}
function validSeparators() {
  const menu = screen.getByRole("menu", { name: "対象部分の操作" });
  const roles = [...menu.children].map(child => child.getAttribute("role"));
  expect(roles[0]).not.toBe("separator"); expect(roles[roles.length - 1]).not.toBe("separator");
  expect(roles.some((role, index) => role === "separator" && roles[index + 1] === "separator")).toBe(false);
}

describe("第2組の自然操作: コードとビジュアルの対象メニュー", () => {
  it("B02-M01 リンク付き画像の内側だけを変換し外側リンクを保つ", () => {
    const content = "[![説明](photo.png)](details.md)"; const convert = vi.fn();
    const preview = visual(content, convert);
    fireEvent.contextMenu(screen.getByRole("img", { name: "説明" })); const expected = items();
    fireEvent.click(screen.getByRole("menuitem", { name: "埋め込みに変換" }));
    const fromVisual = convert.mock.calls[0][0]; preview.unmount();
    const edit = code(content, convert); edit.open(content.indexOf("photo")); expect(items()).toEqual(expected);
    fireEvent.click(screen.getByRole("menuitem", { name: "埋め込みに変換" }));
    expect(convert.mock.calls[1][0].occurrence).toEqual(fromVisual.occurrence);
    expect(convertImage(content, fromVisual)).toBe(`[![説明](${png})](details.md)`);
    expect(edit.changed).not.toHaveBeenCalled();
  });
  it("B02-M02 参照定義を共有する右画像だけを変換する", () => {
    const content = "![左][photo]\n\n![右][photo]\n\n[photo]: image.png"; const convert = vi.fn();
    const preview = visual(content, convert); fireEvent.contextMenu(screen.getByRole("img", { name: "右" }));
    const expected = items(); fireEvent.click(screen.getByRole("menuitem", { name: "埋め込みに変換" }));
    const visualTarget = convert.mock.calls[0][0]; preview.unmount();
    const edit = code(content, convert); edit.open(content.indexOf("右")); expect(items()).toEqual(expected);
    fireEvent.click(screen.getByRole("menuitem", { name: "埋め込みに変換" }));
    expect(convert.mock.calls[1][0].occurrence).toEqual(visualTarget.occurrence);
    expect(convertImage(content, visualTarget)).toBe(`![左][photo]\n\n![右](${png})\n\n[photo]: image.png`);
  });
  it("B02-M03 画像をまたぐ明示選択をコピーし解除後だけ画像操作へ戻る", () => {
    const content = "前の文章 ![図](a.png) 後の文章"; const edit = code(content); const from = 2, to = content.length - 2;
    act(() => edit.editor.dispatch({ selection: { anchor: from, head: to } })); edit.open(content.indexOf("a.png"));
    expect(screen.queryByRole("menuitem", { name: "図としてコピー" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "埋め込みに変換" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "コードをMarkdownでコピー" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(content.slice(from, to));
    act(() => edit.editor.dispatch({ selection: { anchor: 0 } })); edit.open(content.indexOf("a.png"));
    expect(screen.getByRole("menuitem", { name: "図としてコピー" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "埋め込みに変換" })).toBeTruthy();
  });
  it("B02-M04 同じPNG宛でも通常リンクを画像操作にしない", () => {
    const link = "[原寸画像を開く](image.png)"; const content = `${link}\n\n![図](image.png)`;
    const preview = visual(content); fireEvent.contextMenu(screen.getByRole("link", { name: "原寸画像を開く" }));
    expect(screen.queryByRole("menuitem", { name: "図としてコピー" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "埋め込みに変換" })).toBeNull();
    // ビジュアルの段落コピーは既存のブロックコピー契約により末尾改行を含む。
    fireEvent.click(screen.getByRole("menuitem", { name: "コードをMarkdownでコピー" })); expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(link + "\n");
    fireEvent.contextMenu(screen.getByRole("img", { name: "図" })); expect(screen.getByRole("menuitem", { name: "図としてコピー" })).toBeTruthy(); preview.unmount();
    const edit = code(content); edit.open(3); expect(screen.queryByRole("menuitem", { name: "埋め込みに変換" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "コードをMarkdownでコピー" })); expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(link);
    edit.open(content.lastIndexOf("image.png")); expect(screen.getByRole("menuitem", { name: "図としてコピー" })).toBeTruthy();
  });
  it("B02-M05 同一行のインラインコードを隣の実画像と取り違えない", () => {
    const content = "`![記法](same.png)` と ![実画像](same.png)";
    const edit = code(content); edit.open(content.indexOf("記法"));
    expect(screen.queryByRole("menuitem", { name: "図としてコピー" })).toBeNull(); close(); edit.open(content.indexOf("実画像"));
    expect(screen.getByRole("menuitem", { name: "図としてコピー" })).toBeTruthy(); edit.unmount();
    const preview = visual(content); fireEvent.contextMenu(preview.container.querySelector("code")!);
    expect(screen.queryByRole("menuitem", { name: "図としてコピー" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "埋め込みに変換" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "コードをMarkdownでコピー" })); expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith("`![記法](same.png)`");
    fireEvent.contextMenu(screen.getByRole("img", { name: "実画像" })); expect(screen.getByRole("menuitem", { name: "図としてコピー" })).toBeTruthy();
  });
  it("B02-M09 未確定PNGのメニューコピーへステージ画像を渡す（両画面）", async () => {
    const content = "未保存の本文\n\n![未確定](image/pending.png)";
    const preview = visual(content, vi.fn(), { "image/pending.png": png });
    fireEvent.contextMenu(screen.getByRole("img", { name: "未確定" })); fireEvent.click(screen.getByRole("menuitem", { name: "図としてコピー" }));
    await waitFor(() => expect(copyRasterImage).toHaveBeenCalled()); expect(vi.mocked(copyRasterImage).mock.lastCall?.[0]).toBe(png); preview.unmount();
    vi.mocked(copyRasterImage).mockClear(); const edit = code(content, vi.fn(), { "image/pending.png": png }); edit.open(content.indexOf("pending"));
    fireEvent.click(screen.getByRole("menuitem", { name: "図としてコピー" }));
    await waitFor(() => expect(copyRasterImage).toHaveBeenCalled()); expect(vi.mocked(copyRasterImage).mock.lastCall?.[0]).toBe(png);
    expect(edit.changed).not.toHaveBeenCalled();
  });
  it("B02-M15 スキル設定を無効・復帰しても両画面の項目順と区切りを保つ", () => {
    const content = "![図](a.png)"; const preview = visual(content);
    const visualMenus: string[][] = [];
    for (const disabled of [[], ["generate-caption"], ["consult", "edit", "explain-image", "transcribe", "transcribe-table", "improve-diagram", "edit-diagram", "edit-image", "generate-caption", "app-settings"], []]) {
      configuration.disabled = new Set(disabled); preview.refresh(); fireEvent.contextMenu(screen.getByRole("img", { name: "図" })); validSeparators(); visualMenus.push(items()); close();
    }
    expect(visualMenus[1]).not.toContain("AIでキャプション生成"); expect(visualMenus[3]).toEqual(visualMenus[0]);
    expect(visualMenus[2]).toEqual(["図としてコピー", "コードをMarkdownでコピー", "埋め込みに変換", "この画像をAIの送信対象に追加"]);
    preview.unmount(); const edit = code(content);
    for (const [index, disabled] of [[], ["generate-caption"], ["consult", "edit", "explain-image", "transcribe", "transcribe-table", "improve-diagram", "edit-diagram", "edit-image", "generate-caption", "app-settings"], []].entries()) {
      configuration.disabled = new Set(disabled); edit.refresh(); edit.open(3); validSeparators(); expect(items()).toEqual(visualMenus[index]); close();
    }
  });
});
