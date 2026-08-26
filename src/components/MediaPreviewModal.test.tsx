import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaPreviewModal } from "./MediaPreviewModal";

afterEach(cleanup);

describe("MediaPreviewModal", () => {
  it("restores display mode, scale, and pan position from navigation history", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const onViewStateChange = vi.fn();
    render(<MediaPreviewModal
      content={{ kind: "svg", svg: '<svg viewBox="0 0 800 600" />', alt: "履歴" }}
      onClose={vi.fn()}
      initialViewState={{ mode: "actual", scale: 2, display: "diagram", scrollLeft: 120, scrollTop: 80 }}
      onViewStateChange={onViewStateChange}
    />);
    const viewport = document.querySelector<HTMLElement>(".media-preview__viewport")!;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
    });
    act(() => { window.dispatchEvent(new Event("resize")); });

    expect(screen.getByText(/1:1 · 200%/)).toBeTruthy();
    expect(viewport.scrollLeft).toBe(120);
    expect(viewport.scrollTop).toBe(80);
    await waitFor(() => expect(onViewStateChange).toHaveBeenCalledWith(expect.objectContaining({ mode: "actual", scale: 2 })));
    vi.unstubAllGlobals();
  });

  it("opens the image editing workspace from its named action", () => {
    const onActivate = vi.fn();
    render(<MediaPreviewModal content={{ kind: "image", src: "asset://sample.png", alt: "図" }} onClose={vi.fn()} onActivate={onActivate} />);
    fireEvent.click(screen.getByRole("button", { name: "画像編集" }));
    expect(onActivate).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "注釈" })).toBeNull();
  });

  it("uses a click on the expanded raster image for the second-step crop action", () => {
    const onMediaClick = vi.fn();
    render(<MediaPreviewModal content={{ kind: "image", src: "asset://sample.png", alt: "図" }} onClose={vi.fn()} onMediaClick={onMediaClick} />);
    fireEvent.click(screen.getByAltText("図"));
    expect(onMediaClick).toHaveBeenCalledOnce();
  });

  it("disables image editing and explains how to resolve missing permissions", () => {
    render(<MediaPreviewModal
      content={{ kind: "image", src: "asset://readonly.png", alt: "読取り専用" }}
      onClose={vi.fn()}
      editDisabledReason="SharePointで編集権限を付与してください。"
    />);
    const button = screen.getByRole("button", { name: "画像編集" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("SharePointで編集権限を付与してください。");
  });

  it("defaults to maximum-fit display and switches to 1:1", () => {
    render(<MediaPreviewModal content={{ kind: "svg", svg: '<svg viewBox="0 0 400 200" />', alt: "図" }} onClose={vi.fn()} />);

    expect(screen.getByText(/全体表示/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "1:1表示" }));
    expect(screen.getByText(/1:1 · 100%/)).toBeTruthy();
  });

  it("pans the scroll viewport with middle-button dragging", () => {
    render(<MediaPreviewModal content={{ kind: "svg", svg: '<svg viewBox="0 0 400 200" />', alt: "図" }} onClose={vi.fn()} />);
    const viewport = document.querySelector<HTMLElement>(".media-preview__viewport")!;
    Object.assign(viewport, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
    viewport.scrollLeft = 100;
    viewport.scrollTop = 80;

    fireEvent.pointerDown(viewport, { button: 1, clientX: 200, clientY: 150, pointerId: 1 });
    fireEvent.pointerMove(viewport, { clientX: 160, clientY: 120, pointerId: 1 });
    expect(viewport.scrollLeft).toBe(140);
    expect(viewport.scrollTop).toBe(110);
    fireEvent.pointerUp(viewport, { pointerId: 1 });
  });

  it("fits the diagram to the viewport without adding a scrollable blank canvas", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render(<MediaPreviewModal content={{ kind: "svg", svg: '<svg viewBox="0 0 400 200" />', alt: "図" }} onClose={vi.fn()} />);
    const viewport = document.querySelector<HTMLElement>(".media-preview__viewport")!;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    });

    act(() => { window.dispatchEvent(new Event("resize")); });

    const stage = document.querySelector<HTMLElement>(".media-preview__stage")!;
    const transform = document.querySelector<HTMLElement>(".media-preview__transform")!;
    expect(stage.style.width).toBe("800px");
    expect(stage.style.height).toBe("600px");
    expect(transform.style.width).toBe("800px");
    expect(transform.style.height).toBe("400px");
    expect(transform.style.left).toBe("0px");
    expect(transform.style.top).toBe("100px");
    expect(viewport.scrollLeft).toBe(0);
    expect(viewport.scrollTop).toBe(0);
    vi.unstubAllGlobals();
  });

  it("keeps the diagram point under the pointer fixed during smooth unmodified-wheel zoom", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    render(<MediaPreviewModal content={{ kind: "svg", svg: '<svg viewBox="0 0 400 200" />', alt: "図" }} onClose={vi.fn()} />);
    const viewport = document.querySelector<HTMLElement>(".media-preview__viewport")!;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    });
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}),
    });
    act(() => { window.dispatchEvent(new Event("resize")); });

    fireEvent.wheel(viewport, { deltaY: -100, deltaMode: 0, clientX: 200, clientY: 150 });

    expect(viewport.scrollLeft).toBeCloseTo(44.28, 1);
    expect(viewport.scrollTop).toBe(0);
    expect(screen.getByText(/244%/)).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("offers the storage conversion matching the current asset form", async () => {
    const onConvertAsset = vi.fn().mockResolvedValue(undefined);
    const context = { documentPath: "C:/docs/note.md", occurrence: { kind: "inline-svg", id: "inline-svg-0-6", start: 0, end: 6, sourceLine: 1, expected: "<svg/>", svg: "<svg/>" }, assetKind: "svg", storage: "embedded" } as const;
    render(<MediaPreviewModal content={{ kind: "svg", svg: "<svg/>", alt: "図" }} conversionContext={context} onConvertAsset={onConvertAsset} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "同フォルダのファイルへ変換" }));
    await waitFor(() => expect(onConvertAsset).toHaveBeenCalledWith(context));
  });

  it("shows code, raster, and vector copy actions for diagram previews without a code view toggle", () => {
    render(<MediaPreviewModal
      content={{ kind: "svg", svg: '<svg viewBox="0 0 400 200" />', alt: "draw.io図" }}
      diagramSource="<mxGraphModel/>"
      diagramKind="drawio"
      onClose={vi.fn()}
    />);

    expect(screen.getByRole("toolbar", { name: "draw.io全画面操作" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "コードをコピー" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ラスタコピー" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ベクタコピー" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "プレビュー" })).toBeNull();
    expect(screen.queryByRole("button", { name: "コード" })).toBeNull();
    expect(document.querySelector(".media-preview__source")).toBeNull();
  });
});
