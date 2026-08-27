import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DRAWIO_ORIGIN } from "../lib/drawio";
import { DrawioEditorModal } from "./DrawioEditorModal";

describe("DrawioEditorModal", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("loads and saves only messages from the expected diagrams.net frame", async () => {
    const onSave = vi.fn(() => true);
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
    expect(postMessage).toHaveBeenCalledWith(expect.stringContaining('"border":32'), DRAWIO_ORIGIN);

    window.dispatchEvent(new MessageEvent("message", { origin: DRAWIO_ORIGIN, source: frame, data: JSON.stringify({ event: "load", pageVisible: true }) }));
    expect(postMessage).not.toHaveBeenCalledWith(JSON.stringify({ action: "invokeAction", actionName: "pageView" }), DRAWIO_ORIGIN);
    expect(postMessage).toHaveBeenCalledWith(JSON.stringify({ action: "fit", border: 32, maxScale: 1 }), DRAWIO_ORIGIN);
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(3));
    expect(postMessage).toHaveBeenLastCalledWith(JSON.stringify({ action: "fit", border: 32, maxScale: 1 }), DRAWIO_ORIGIN);

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
});
