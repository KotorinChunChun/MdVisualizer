import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaPreviewModal } from "./MediaPreviewModal";

afterEach(cleanup);

describe("MediaPreviewModal", () => {
  it("opens the image editing workspace from its named action", () => {
    const onActivate = vi.fn();
    render(<MediaPreviewModal content={{ kind: "image", src: "asset://sample.png", alt: "図" }} onClose={vi.fn()} onActivate={onActivate} />);
    fireEvent.click(screen.getByRole("button", { name: "画像編集" }));
    expect(onActivate).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "注釈" })).toBeNull();
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

  it("centers the diagram within a pan canvas that has space on every side", () => {
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
    expect(stage.style.width).toBe("2400px");
    expect(stage.style.height).toBe("1600px");
    expect(viewport.scrollLeft).toBe(800);
    expect(viewport.scrollTop).toBe(500);
    vi.unstubAllGlobals();
  });

  it("keeps the diagram point under the pointer fixed during smooth ctrl-wheel zoom", () => {
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

    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -100, deltaMode: 0, clientX: 200, clientY: 150 });

    expect(viewport.scrollLeft).toBeCloseTo(844.28, 1);
    expect(viewport.scrollTop).toBeCloseTo(511.07, 1);
    expect(screen.getByText(/244%/)).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
