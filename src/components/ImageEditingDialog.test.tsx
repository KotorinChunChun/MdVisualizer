import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageEditingDialog } from "./ImageEditingDialog";
import { readImageForEdit } from "../lib/commands";

vi.mock("../lib/commands", () => ({ readImageForEdit: vi.fn() }));
vi.mock("./ImageAnnotationEditor", () => ({ ImageAnnotationEditor: ({ target }: { target: object }) => <pre data-testid="legacy">{JSON.stringify(target)}</pre> }));
vi.mock("./RasterEditor2", () => ({ RasterEditor2: ({ target }: { target: object }) => <pre data-testid="new">{JSON.stringify(target)}</pre> }));
const safe = "data:image/png;base64,aGVsbG8=";
const props = () => ({ target: { rawSrc: "http://asset.localhost/C/test.jpg", fullPath: "C:\\test.jpg", filename: "test.jpg", storage: "external" as const }, imageVersion: 0, onApply: vi.fn(), onCancel: vi.fn(), onError: vi.fn() });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
describe("画像編集選択と安全な読込み", () => {
  it("読込み失敗後に元画像を再試行できる", async () => {
    vi.mocked(readImageForEdit).mockRejectedValueOnce(new Error("読込み失敗")).mockResolvedValue(safe);
    render(<ImageEditingDialog {...props()} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "ラスタ編集2" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("ペイント起動失敗後は作成済み白紙を再作成しない", async () => {
    vi.mocked(readImageForEdit).mockResolvedValueOnce(null).mockResolvedValue(safe);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(safe);
    const onPaint = vi.fn().mockRejectedValue(new Error("起動失敗"));
    render(<ImageEditingDialog {...props()} onPaint={onPaint} />);
    await screen.findByText(/白紙から新規作成/);
    fireEvent.click(screen.getByRole("button", { name: "ペイント" }));
    await waitFor(() => expect(screen.queryByText(/白紙から新規作成/)).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "ペイント" }));
    await waitFor(() => expect(onPaint).toHaveBeenCalledTimes(2));
    expect(onPaint.mock.calls[0][0].createNew).toBe(true);
    expect(onPaint.mock.calls[1][0].createNew).toBe(false);
  });
  it.each([["ラスタ編集1", "legacy"], ["ラスタ編集2", "new"]])("%sへネイティブ読込Data URIを渡す", async (name, id) => {
    vi.mocked(readImageForEdit).mockResolvedValue(safe); render(<ImageEditingDialog {...props()} />);
    await waitFor(() => expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name }));
    const result = JSON.parse(screen.getByTestId(id).textContent!);
    expect(result.rawSrc).toBe(safe); expect(result.fullPath).toBe("C:\\test.jpg"); expect(result.createNew).toBe(false);
  });
  it("読込み失敗を欠落と混同せず新規保存しない", async () => {
    vi.mocked(readImageForEdit).mockRejectedValue(new Error("権限なし")); render(<ImageEditingDialog {...props()} />);
    await screen.findByRole("alert"); expect(screen.queryByText(/白紙から新規作成/)).toBeNull();
    expect((screen.getByRole("button", { name: "ラスタ編集1" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("欠落時は白紙を生成し、キャンセルだけでは保存しない", async () => {
    vi.mocked(readImageForEdit).mockResolvedValue(null);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(safe);
    const p = props(); render(<ImageEditingDialog {...p} />);
    await screen.findByText(/白紙から新規作成/);
    fireEvent.change(screen.getByLabelText(/幅/), { target: { value: "0" } });
    expect((screen.getByRole("button", { name: "ラスタ編集2" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/幅/), { target: { value: "640" } });
    fireEvent.click(screen.getByRole("button", { name: "ラスタ編集2" }));
    expect(JSON.parse(screen.getByTestId("new").textContent!).createNew).toBe(true);
    expect(p.onApply).not.toHaveBeenCalled();
  });
  it("ペイントへ実パスを渡し、失敗時は選択画面を保持する", async () => {
    vi.mocked(readImageForEdit).mockResolvedValue(safe); const onPaint = vi.fn().mockRejectedValue(new Error("起動失敗"));
    render(<ImageEditingDialog {...props()} onPaint={onPaint} />);
    await waitFor(() => expect((screen.getByRole("button", { name: "ペイント" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "ペイント" }));
    await screen.findByRole("alert"); expect(onPaint.mock.calls[0][0].fullPath).toBe("C:\\test.jpg");
    expect(screen.getByRole("dialog", { name: "画像編集を選択" })).toBeTruthy();
  });
});
