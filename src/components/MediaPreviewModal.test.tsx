import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaPreviewModal } from "./MediaPreviewModal";

afterEach(cleanup);

describe("MediaPreviewModal", () => {
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
});
