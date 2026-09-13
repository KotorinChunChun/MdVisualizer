import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexImageEdit } from "./CodexImageEdit";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";

afterEach(cleanup);

const baseProps = (source = "a.png") => ({
  documentPath: "C:\\docs\\a.md",
  source,
  originalBase64: "iVBORw0KGgo=",
  onReferenceChange: vi.fn(async () => true),
});

async function requestEdit() {
  fireEvent.change(screen.getByRole("textbox", { name: "編集指示" }), { target: { value: "青くする" } });
  fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
  await screen.findByText("変更後");
}

describe("CodexImageEdit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(invoke).mockResolvedValue({ base64: "new", mediaType: "image/png", filename: "edited.png" });
  });

  it("埋め込みPNGはデータURI参照を差し替え、保存IPCを呼ばない", async () => {
    const input = baseProps("data:image/png;base64,OLD");
    render(<CodexImageEdit {...input} />);
    await requestEdit();
    fireEvent.click(screen.getByRole("button", { name: "この画像を採用" }));

    await waitFor(() => expect(input.onReferenceChange).toHaveBeenCalledWith(
      "data:image/png;base64,OLD",
      "data:image/png;base64,new",
    ));
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "codex_save_edited_image")).toBe(false);
  });

  it("外部PNGの3択と保存ファイル名を保存IPCへ伝搬し、確定する", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ base64: "new", mediaType: "image/png", filename: "edited.png" })
      .mockResolvedValueOnce({ newSource: "edited.png", rollbackId: "rb1" })
      .mockResolvedValueOnce(undefined);
    const input = baseProps();
    render(<CodexImageEdit {...input} />);
    await requestEdit();
    expect(screen.getByLabelText("元画像を上書き")).toBeTruthy();
    expect(screen.getByLabelText("別名で保存して参照を更新")).toBeTruthy();
    expect(screen.getByLabelText("元画像をarchiveへ残して同じファイル名で置換")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("保存ファイル名"), { target: { value: "final.png" } });
    fireEvent.click(screen.getByRole("button", { name: "この画像を採用" }));

    await waitFor(() => expect(input.onReferenceChange).toHaveBeenCalledWith("a.png", "edited.png"));
    expect(invoke).toHaveBeenNthCalledWith(2, "codex_save_edited_image", expect.objectContaining({
      request: expect.objectContaining({ mode: "new", filename: "final.png" }),
    }));
    expect(invoke).toHaveBeenNthCalledWith(3, "codex_finalize_edited_image", { rollbackId: "rb1", commit: true });
  });

  it("参照更新がfalseならrollbackし、rollback失敗を表示する", async () => {
    const input = baseProps();
    input.onReferenceChange.mockResolvedValue(false);
    vi.mocked(invoke)
      .mockResolvedValueOnce({ base64: "new", mediaType: "image/png", filename: "edited.png" })
      .mockResolvedValueOnce({ newSource: "edited.png", rollbackId: "rb1" })
      .mockRejectedValueOnce(new Error("rollback failed"));
    render(<CodexImageEdit {...input} />);
    await requestEdit();
    fireEvent.click(screen.getByRole("button", { name: "この画像を採用" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("自動復旧に失敗しました");
    expect(invoke).toHaveBeenNthCalledWith(3, "codex_finalize_edited_image", { rollbackId: "rb1", commit: false });
  });

  it("停止・unmount後の遅い編集結果を無視する", async () => {
    let resolveEdit!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "codex_edit_image") return new Promise(resolve => { resolveEdit = resolve; });
      return Promise.resolve(undefined);
    });
    const { unmount } = render(<CodexImageEdit {...baseProps()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "編集指示" }), { target: { value: "青くする" } });
    fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(invoke).toHaveBeenCalledWith("codex_cancel_image", expect.objectContaining({ id: expect.any(String) }));
    unmount();
    resolveEdit({ base64: "late", mediaType: "image/png", filename: "late.png" });
    await waitFor(() => expect(screen.queryByText("変更後")).toBeNull());
  });

  it("Ctrl+Enterで送信し、生成成功時に指示を一度だけ通知する", async () => {
    const onGenerated = vi.fn();
    vi.mocked(invoke).mockResolvedValue({ base64: "new", mediaType: "image/png", filename: "edited.png" });
    render(<CodexImageEdit {...baseProps()} onGenerated={onGenerated} />);
    const input = screen.getByRole("textbox", { name: "編集指示" });
    fireEvent.change(input, { target: { value: "青くする" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await screen.findByText("変更後");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("codex_edit_image", expect.anything());
    expect(onGenerated).toHaveBeenCalledTimes(1);
    expect(onGenerated).toHaveBeenCalledWith("青くする");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("初回のAI利用同意が拒否された画像編集は送信しない", async () => {
    const onRequestAuthorization = vi.fn(async () => false);
    render(<CodexImageEdit {...baseProps()} onRequestAuthorization={onRequestAuthorization} />);
    fireEvent.change(screen.getByRole("textbox", { name: "編集指示" }), { target: { value: "青くする" } });
    fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
    await waitFor(() => expect(onRequestAuthorization).toHaveBeenCalledTimes(1));
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("codex_edit_image", expect.anything());
    expect(screen.getByRole("textbox", { name: "編集指示" })).toHaveValue("青くする");
  });

  it("同意待ち中に対象画像が変わった場合は古い画像を送信しない", async () => {
    let authorize!: (value: boolean) => void;
    const onRequestAuthorization = vi.fn(() => new Promise<boolean>(resolve => { authorize = resolve; }));
    const view = render(<CodexImageEdit {...baseProps("a.png")} onRequestAuthorization={onRequestAuthorization} />);
    fireEvent.change(screen.getByRole("textbox", { name: "編集指示" }), { target: { value: "青くする" } });
    fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
    await waitFor(() => expect(onRequestAuthorization).toHaveBeenCalledTimes(1));
    view.rerender(<CodexImageEdit {...baseProps("b.png")} onRequestAuthorization={onRequestAuthorization} />);
    await act(async () => { authorize(true); });
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("codex_edit_image", expect.anything());
  });

  it("送信中は状態表示と停止を表示し、停止後の結果を無視する", async () => {
    let resolveEdit!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation((command) => command === "codex_edit_image"
      ? new Promise(resolve => { resolveEdit = resolve; })
      : Promise.resolve(undefined));
    render(<CodexImageEdit {...baseProps()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "編集指示" }), { target: { value: "青くする" } });
    fireEvent.click(screen.getByRole("button", { name: "画像編集を依頼" }));
    expect(screen.getByRole("status")).toHaveTextContent("送信中");
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(screen.queryByRole("status")).toBeNull();
    resolveEdit({ base64: "late", mediaType: "image/png", filename: "late.png" });
    await waitFor(() => expect(screen.queryByText("変更後")).toBeNull());
  });
});
