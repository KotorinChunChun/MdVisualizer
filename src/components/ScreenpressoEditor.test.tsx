import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenpressoEditor } from "./ScreenpressoEditor";
import { saveRenderedImage } from "../lib/commands";
import { pngBytes, screenpressoDocument, screenpressoSupported } from "../lib/screenpressoHost";

vi.mock("../lib/commands", () => ({ saveRenderedImage: vi.fn() }));
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const props = () => ({ target: { rawSrc: png, filename: "sample.jpg", fullPath: "C:\\sample.jpg", storage: "external" as const }, imageVersion: 0, onApply: vi.fn(), onCancel: vi.fn(), onError: vi.fn() });

beforeEach(() => {
  vi.stubGlobal("Image", class {
    naturalWidth = 320; naturalHeight = 240; onload?: () => void;
    set src(_: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(png);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function setup(p = props()) {
  const view = render(<ScreenpressoEditor {...p} />);
  const frame = screen.getByTitle("Screenpressoもどき画像編集") as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  fireEvent.load(frame);
  await waitFor(() => expect(post).toHaveBeenCalled());
  const session = post.mock.calls.find(([m]) => m.type === "load")![0].session;
  const emit = (message: Record<string, unknown>, source: MessageEventSource | null = frame.contentWindow) => act(async () => {
    window.dispatchEvent(new MessageEvent("message", { source, data: { channel: "mdv-image", session, ...message } }));
  });
  await emit({ type: "loaded" });
  const apply = () => {
    fireEvent.click(screen.getByRole("button", { name: "反映" }));
    return post.mock.calls.find(([m]) => m.type === "render")![0].request;
  };
  return { ...view, p, frame, post, emit, apply };
}

describe("Screenpresso integration", () => {
  it("saves a JPEG target through the existing PNG-to-original-format backup API once", async () => {
    vi.mocked(saveRenderedImage).mockResolvedValue({ backup_available: true } as Awaited<ReturnType<typeof saveRenderedImage>>);
    const t = await setup(); const request = t.apply();
    await t.emit({ type: "result", request, dataUri: png });
    await t.emit({ type: "result", request, dataUri: png });
    expect(saveRenderedImage).toHaveBeenCalledTimes(1);
    expect(saveRenderedImage).toHaveBeenCalledWith({ path: "C:\\sample.jpg", pngBytes: pngBytes(png), expectedSourceWidth: 320, expectedSourceHeight: 240 });
    expect(t.p.onApply).toHaveBeenCalledWith({ filename: "sample.jpg", backupAvailable: true });
  });
  it("ignores another window, wrong session and unsolicited or mismatched responses", async () => {
    const t = await setup(); const request = t.apply();
    await t.emit({ type: "result", request, dataUri: png }, window);
    await t.emit({ type: "result", request, dataUri: png, session: "wrong" });
    await t.emit({ type: "result", request: "wrong", dataUri: png });
    expect(saveRenderedImage).not.toHaveBeenCalled(); expect(t.p.onApply).not.toHaveBeenCalled();
  });
  it("retains the editor and original on save failure and permits retry", async () => {
    vi.mocked(saveRenderedImage).mockRejectedValue(new Error("書込み不可"));
    const t = await setup(); const request = t.apply();
    await t.emit({ type: "result", request, dataUri: png });
    expect(screen.getByRole("alert").textContent).toContain("書込み不可");
    expect(t.p.onApply).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "反映" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("blocks an external change, including a response already requested", async () => {
    const t = await setup(); const request = t.apply();
    t.rerender(<ScreenpressoEditor {...t.p} imageVersion={1} />);
    await t.emit({ type: "result", request, dataUri: png });
    expect(saveRenderedImage).not.toHaveBeenCalled(); expect(t.p.onApply).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "反映" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("returns embedded PNG data without touching external files", async () => {
    const p = { ...props(), target: { rawSrc: png, filename: "inline.png", storage: "embedded" as const } };
    const view = render(<ScreenpressoEditor {...p} />);
    const frame = screen.getByTitle("Screenpressoもどき画像編集") as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, "postMessage"); fireEvent.load(frame);
    await waitFor(() => expect(post).toHaveBeenCalled());
    const session = post.mock.calls[0][0].session;
    const emit = async (m: object) => act(async () => { window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data: { channel: "mdv-image", session, ...m } })); });
    await emit({ type: "loaded" }); fireEvent.click(screen.getByRole("button", { name: "反映" }));
    await emit({ type: "result", request: post.mock.calls[post.mock.calls.length - 1][0].request, dataUri: png });
    expect(saveRenderedImage).not.toHaveBeenCalled(); expect(p.onApply).toHaveBeenCalledWith({ filename: "inline.png", backupAvailable: false, dataUri: png });
    view.unmount();
  });
  it("confirms cancel without writing anything", async () => {
    const t = await setup(); const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" })); expect(t.p.onCancel).not.toHaveBeenCalled();
    confirm.mockReturnValue(true); fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(t.p.onCancel).toHaveBeenCalledOnce(); expect(saveRenderedImage).not.toHaveBeenCalled();
  });
  it("rejects non-PNG payloads and invalid signatures", () => {
    for (const data of [null, "https://evil/image.png", "data:image/png;base64,YWJj", "data:image/jpeg;base64,YWJj"]) expect(() => pngBytes(data)).toThrow();
  });
  it("isolates the original HTML and selects only PNG/JPEG", () => {
    const html = screenpressoDocument("test-session");
    expect(html).toContain("connect-src 'none'"); expect(html).toContain("event.source !== parent");
    expect(screenpressoSupported("a.JPG", "")).toBe(true); expect(screenpressoSupported("a.svg", "")).toBe(false);
    expect(screenpressoSupported("画像", png)).toBe(true);
  });
});
