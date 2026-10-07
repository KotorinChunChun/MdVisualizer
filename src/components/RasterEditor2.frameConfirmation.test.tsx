import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RasterEditor2 } from "./RasterEditor2";
import { saveRenderedImage } from "../lib/commands";
vi.mock("../lib/commands", () => ({ saveRenderedImage: vi.fn(), createRenderedImage: vi.fn() }));
vi.mock("../lib/rasterOutput", () => ({ saveRasterCopy: vi.fn() }));
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
beforeEach(() => {
  vi.stubGlobal("Image", class { naturalWidth = 160; naturalHeight = 100; onload?: () => void; set src(_value: string) { queueMicrotask(() => this.onload?.()); } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(png);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function setup() {
  const props = { target: { rawSrc: png, filename: "fixture.png", storage: "embedded" as const }, imageVersion: 0, onApply: vi.fn(), onCancel: vi.fn(), onError: vi.fn() };
  const view = render(<RasterEditor2 {...props} />); const frame = screen.getByTitle("ラスタ編集2画像編集") as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, "postMessage"); fireEvent.load(frame);
  await waitFor(() => expect(post).toHaveBeenCalled()); const session = post.mock.calls.find(([message]) => message.type === "load")![0].session;
  const emit = (extra: object, source: MessageEventSource | null = frame.contentWindow) => act(async () => { window.dispatchEvent(new MessageEvent("message", { source, data: { channel: "mdv-image", session, ...extra } })); });
  await emit({ type: "loaded" }); await emit({ type: "changed", dirty: true });
  const responses = () => post.mock.calls.map(([message]) => message).filter(message => message.type === "confirm-replace-result");
  return { ...view, props, post, emit, responses };
}
describe("ラスタ編集2内部から親の確認APIへ委譲する", () => {
  it.each([false, true])("確認結果%sを同じ要求へ返し、保存処理を開始しない", async answer => {
    const t = await setup(); const confirm = vi.spyOn(window, "confirm").mockImplementation(() => Promise.resolve(answer) as unknown as boolean);
    await t.emit({ type: "confirm-replace", request: "replace-1" });
    expect(confirm).toHaveBeenCalledOnce(); expect(t.responses()).toEqual([expect.objectContaining({ request: "replace-1", confirmed: answer })]);
    expect(saveRenderedImage).not.toHaveBeenCalled(); expect(t.props.onApply).not.toHaveBeenCalled(); expect(t.props.onCancel).not.toHaveBeenCalled();
  });
  it("別source/sessionを無視し、保留中の二重依頼と外側保存を抑止する", async () => {
    const t = await setup(); let resolve!: (value: boolean) => void;
    const confirm = vi.spyOn(window, "confirm").mockImplementation(() => new Promise<boolean>(done => { resolve = done; }) as unknown as boolean);
    await t.emit({ type: "confirm-replace", request: "wrong" }, window); await t.emit({ type: "confirm-replace", request: "wrong", session: "wrong" }); expect(confirm).not.toHaveBeenCalled();
    await t.emit({ type: "confirm-replace", request: "replace-1" }); await t.emit({ type: "confirm-replace", request: "replace-2" });
    expect(confirm).toHaveBeenCalledOnce(); fireEvent.click(screen.getByRole("button", { name: "文書へ反映" })); expect(t.post.mock.calls.some(([message]) => message.type === "render")).toBe(false);
    await act(async () => resolve(true)); expect(t.responses().find(message => message.request === "replace-1")?.confirmed).toBe(true);
  });
  it.each(["edit", "version", "target"])("確認中の%s変更後は古い承認を返さない", async change => {
    const t = await setup(); let resolve!: (value: boolean) => void;
    vi.spyOn(window, "confirm").mockImplementation(() => new Promise<boolean>(done => { resolve = done; }) as unknown as boolean);
    await t.emit({ type: "confirm-replace", request: "replace-1" });
    if (change === "edit") await t.emit({ type: "changed", dirty: true });
    else t.rerender(<RasterEditor2 {...t.props} {...(change === "version" ? { imageVersion: 1 } : { target: { ...t.props.target, filename: "next.png" } })} />);
    await act(async () => resolve(true)); expect(t.responses().some(message => message.request === "replace-1" && message.confirmed === true)).toBe(false);
  });
  it("確認失敗を承認へ変えず、再依頼できる", async () => {
    const t = await setup(); const confirm = vi.spyOn(window, "confirm").mockImplementation(() => Promise.reject(new Error("確認の失敗")) as unknown as boolean);
    await t.emit({ type: "confirm-replace", request: "replace-1" }); expect(t.responses()[0]).toMatchObject({ confirmed: false, error: expect.stringContaining("確認の失敗") });
    confirm.mockImplementation(() => Promise.resolve(true) as unknown as boolean); await t.emit({ type: "confirm-replace", request: "replace-2" });
    expect(t.responses().find(message => message.request === "replace-2")?.confirmed).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("画面を閉じた後の古いtrueで保存や承認応答を出さない", async () => {
    const t = await setup(); let resolve!: (value: boolean) => void;
    vi.spyOn(window, "confirm").mockImplementation(() => new Promise<boolean>(done => { resolve = done; }) as unknown as boolean);
    await t.emit({ type: "confirm-replace", request: "replace-1" }); t.unmount(); await act(async () => resolve(true));
    expect(t.responses().some(message => message.confirmed === true)).toBe(false); expect(t.props.onApply).not.toHaveBeenCalled(); expect(saveRenderedImage).not.toHaveBeenCalled();
  });
});
