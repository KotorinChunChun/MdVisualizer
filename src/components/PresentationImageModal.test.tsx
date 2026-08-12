import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresentationImageModal } from "./PresentationImageModal";

describe("PresentationImageModal", () => {
  afterEach(cleanup);

  it("zooms smoothly with ctrl-wheel and closes with Escape", () => {
    const onClose = vi.fn();
    render(<PresentationImageModal target={{ src: "test.png", alt: "test", cropTarget: null }} onClose={onClose} onEdit={() => {}} />);

    fireEvent.wheel(screen.getByRole("img"), { ctrlKey: true, deltaY: -100, clientX: 100, clientY: 80 });
    expect(screen.getByText(/122%/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens editing only when a local raster crop target exists", () => {
    const onEdit = vi.fn();
    const cropTarget = { rawSrc: "asset://test.png", fullPath: "C:\\test.png", filename: "test.png" };
    render(<PresentationImageModal target={{ src: "asset://test.png", alt: "test", cropTarget }} onClose={() => {}} onEdit={onEdit} />);

    fireEvent.click(screen.getByRole("img"));
    expect(onEdit).toHaveBeenCalledWith(cropTarget);
  });

  it("switches between maximum fit and dot-by-dot display", () => {
    render(<PresentationImageModal target={{ src: "test.png", alt: "test", cropTarget: null }} onClose={() => {}} onEdit={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "1:1表示" }));
    expect(screen.getByText(/1:1 · 100%/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "全体表示" })).toBeTruthy();
  });
});
