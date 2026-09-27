import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DRAWIO_ORIGIN } from "../lib/drawio";
import { DrawioEditorModal } from "./DrawioEditorModal";

describe("DrawioEditorModal", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("loads and saves only messages from the expected diagrams.net frame", async () => {
    const onSave = vi.fn((_source: string) => true);
    const onCancel = vi.fn();
    render(<DrawioEditorModal source="<mxGraphModel><root/></mxGraphModel>" onSave={onSave} onCancel={onCancel} />);
    const iframe = screen.getByTitle("draw.io editor") as HTMLIFrameElement;
    const frame = iframe.contentWindow!;
    const postMessage = vi.spyOn(frame, "postMessage").mockImplementation(() => undefined);

    window.dispatchEvent(new MessageEvent("message", { origin: "https://evil.example", source: frame, data: { event: "init" } }));
    window.dispatchEvent(new MessageEvent("message", { origin: DRAWIO_ORIGIN, source: window, data: { event: "init" } }));
    expect(postMessage).not.toHaveBeenCalled();

    window.dispatchEvent(new MessageEvent("message", { origin: DRAWIO_ORIGIN, source: frame, data: JSON.stringify({ event: "init" }) }));
    expect(postMessage).toHaveBeenCalledWith(expect.stringContaining('"action":"load"'), DRAWIO_ORIGIN);
    expect(postMessage).toHaveBeenCalledWith(expect.stringContaining('page=\\"0\\"'), DRAWIO_ORIGIN);
    expect(postMessage).toHaveBeenCalledWith(expect.stringContaining('"maxFitScale":1'), DRAWIO_ORIGIN);
    expect(postMessage).toHaveBeenCalledWith(expect.stringContaining('"border":48'), DRAWIO_ORIGIN);

    window.dispatchEvent(new MessageEvent("message", { origin: DRAWIO_ORIGIN, source: frame, data: JSON.stringify({ event: "load", pageVisible: true }) }));
    expect(postMessage).not.toHaveBeenCalledWith(JSON.stringify({ action: "invokeAction", actionName: "pageView" }), DRAWIO_ORIGIN);
    expect(postMessage).toHaveBeenCalledWith(JSON.stringify({ action: "fit", border: 48, maxScale: 1 }), DRAWIO_ORIGIN);
    expect(postMessage).toHaveBeenCalledWith(JSON.stringify({ action: "invokeAction", actionName: "fitWindow" }), DRAWIO_ORIGIN);

    window.dispatchEvent(new MessageEvent("message", { origin: DRAWIO_ORIGIN, source: frame, data: { event: "save", xml: "<mxfile><diagram><mxGraphModel><root/></mxGraphModel></diagram></mxfile>", exit: true } }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.stringContaining("mxGraphModel")));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does not change Markdown when the editor exits without saving", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<DrawioEditorModal source="" onSave={onSave} onCancel={onCancel} />);
    const frame = (screen.getByTitle("draw.io editor") as HTMLIFrameElement).contentWindow!;
    window.dispatchEvent(new MessageEvent("message", { origin: DRAWIO_ORIGIN, source: frame, data: { event: "exit", modified: true } }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("SVG入力は要求したxmlsvg書出しだけをサニタイズして元形式のまま保存する", async () => {
    const onSave = vi.fn((_source: string) => true);
    const onCancel = vi.fn();
    render(<DrawioEditorModal source={'<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'} onSave={onSave} onCancel={onCancel} />);
    const frame = (screen.getByTitle("draw.io editor") as HTMLIFrameElement).contentWindow!;
    const postMessage = vi.spyOn(frame, "postMessage").mockImplementation(() => undefined);
    window.dispatchEvent(new MessageEvent("message", { origin: DRAWIO_ORIGIN, source: frame, data: { event: "save", xml: "<mxGraphModel><root/></mxGraphModel>", exit: true } }));
    const exportCall = postMessage.mock.calls.map(([value]) => JSON.parse(String(value))).find((value) => value.action === "export");
    expect(exportCall).toMatchObject({ action: "export", format: "xmlsvg", xml: "<mxGraphModel><root/></mxGraphModel>" });
    window.dispatchEvent(new MessageEvent("message", { origin: DRAWIO_ORIGIN, source: frame, data: { event: "exit" } }));
    expect(onCancel).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent("message", { origin: DRAWIO_ORIGIN, source: frame, data: { event: "export", format: "svg", message: { action: "export", format: "xmlsvg", message: "stale" }, data: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E" } }));
    expect(onSave).not.toHaveBeenCalled();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" content="%3CmxGraphModel%2F%3E"><script>bad()</script><rect width="10" height="10"/></svg>';
    window.dispatchEvent(new MessageEvent("message", { origin: DRAWIO_ORIGIN, source: frame, data: { event: "export", format: "svg", message: { action: "export", format: "xmlsvg", message: exportCall.message }, data: `data:image/svg+xml,${encodeURIComponent(svg)}` } }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(expect.stringContaining('content="%3CmxGraphModel%2F%3E"'));
    expect(onSave.mock.calls[0][0]).not.toContain("<script");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("未要求または不正なSVG書出しを保存しない", async () => {
    const onSave = vi.fn();
    render(<DrawioEditorModal source={'<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'} onSave={onSave} onCancel={vi.fn()} />);
    const frame = (screen.getByTitle("draw.io editor") as HTMLIFrameElement).contentWindow!;
    const calls = vi.spyOn(frame, "postMessage").mockImplementation(() => undefined);
    window.dispatchEvent(new MessageEvent("message", { origin: DRAWIO_ORIGIN, source: frame, data: { event: "export", format: "svg", message: { action: "export", format: "xmlsvg", message: "unrequested" }, data: "data:image/svg+xml,%3Csvg%2F%3E" } }));
    expect(onSave).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent("message", { origin: DRAWIO_ORIGIN, source: frame, data: { event: "save", xml: "<mxGraphModel><root/></mxGraphModel>" } }));
    const request = calls.mock.calls.map(([value]) => JSON.parse(String(value))).find((value) => value.action === "export");
    window.dispatchEvent(new MessageEvent("message", { origin: DRAWIO_ORIGIN, source: frame, data: { event: "export", format: "svg", message: { action: "export", format: "xmlsvg", message: request.message }, data: "data:image/png;base64,YQ==" } }));
    await screen.findByRole("alert");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("ignores delayed layout messages after the iframe window becomes unavailable", () => {
    vi.useFakeTimers();
    const { unmount } = render(<DrawioEditorModal source="" onSave={vi.fn()} onCancel={vi.fn()} />);
    const frame = (screen.getByTitle("draw.io editor") as HTMLIFrameElement).contentWindow!;
    const postMessage = vi.spyOn(frame, "postMessage").mockImplementation(() => undefined);

    window.dispatchEvent(new MessageEvent("message", { origin: DRAWIO_ORIGIN, source: frame, data: JSON.stringify({ event: "init" }) }));
    postMessage.mockImplementation(() => { throw new TypeError("iframe is unavailable"); });

    expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
    unmount();
    expect(() => vi.runAllTimers()).not.toThrow();
  });
});
