import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cropImage } from "../lib/commands";
import { CropOverlay } from "./CropOverlay";

vi.mock("../lib/commands", () => ({ cropImage: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CropOverlay", () => {
  it("starts with a full-image selection and sends the source dimensions", async () => {
    vi.mocked(cropImage).mockResolvedValue({
      path: "C:\\docs\\image.png",
      backup_available: true,
      width: 640,
      height: 480,
    });
    const onApply = vi.fn();
    const { container } = render(
      <CropOverlay
        target={{ rawSrc: "asset://image.png", fullPath: "C:\\docs\\image.png", filename: "image.png" }}
        onApply={onApply}
        onCancel={() => {}}
        onError={() => {}}
      />,
    );
    const image = screen.getByAltText("image.png");
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 640 },
      naturalHeight: { configurable: true, value: 480 },
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
    });
    fireEvent.load(image);

    const box = container.querySelector<HTMLElement>(".crop-box");
    expect(box?.style.left).toBe("0%");
    expect(box?.style.top).toBe("0%");
    expect(box?.style.width).toBe("100%");
    expect(box?.style.height).toBe("100%");

    fireEvent.click(screen.getByRole("button", { name: /適用/ }));
    await waitFor(() => expect(cropImage).toHaveBeenCalledWith({
      path: "C:\\docs\\image.png",
      x: 0,
      y: 0,
      width: 640,
      height: 480,
      expectedSourceWidth: 640,
      expectedSourceHeight: 480,
    }));
    expect(onApply).toHaveBeenCalledWith("image.png", true);
  });
});
