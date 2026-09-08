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
    expect(screen.getAllByRole("button", { name: /クロップ境界/ })).toHaveLength(8);

    fireEvent.click(screen.getByRole("button", { name: /^✅ 適用/ }));
    await waitFor(() => expect(cropImage).toHaveBeenCalledWith({
      path: "C:\\docs\\image.png",
      x: 0,
      y: 0,
      width: 640,
      height: 480,
      paddingMode: "auto",
      expectedSourceWidth: 640,
      expectedSourceHeight: 480,
    }));
    expect(onApply).toHaveBeenCalledWith("image.png", true);
  });

  it("lets a boundary extend beyond the source image", () => {
    const { container } = render(
      <CropOverlay
        target={{ rawSrc: "asset://image.png", fullPath: "C:\\docs\\image.png", filename: "image.png" }}
        onApply={() => {}}
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
      getBoundingClientRect: { configurable: true, value: () => ({ width: 640, height: 480 }) },
    });
    fireEvent.load(image);

    fireEvent.mouseDown(screen.getByRole("button", { name: "左のクロップ境界" }), { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: -64, clientY: 0 });

    const box = container.querySelector<HTMLElement>(".crop-box");
    expect(box?.style.left).toBe("-10%");
    expect(box?.style.width).toBe("110%");
  });

  it("resizes the opposite boundary symmetrically while Ctrl is held", () => {
    const { container } = render(<CropOverlay target={{ rawSrc: "asset://image.png", fullPath: "C:\\docs\\image.png", filename: "image.png" }} onApply={() => {}} onCancel={() => {}} onError={() => {}} />);
    const image = screen.getByAltText("image.png");
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 640 }, naturalHeight: { configurable: true, value: 480 },
      clientWidth: { configurable: true, value: 640 }, clientHeight: { configurable: true, value: 480 },
      getBoundingClientRect: { configurable: true, value: () => ({ width: 640, height: 480 }) },
    });
    fireEvent.load(image);
    fireEvent.mouseDown(screen.getByRole("button", { name: "左のクロップ境界" }), { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 64, clientY: 0, ctrlKey: true });
    const box = container.querySelector<HTMLElement>(".crop-box");
    expect(box?.style.left).toBe("10%");
    expect(box?.style.width).toBe("80%");
  });

  it("disables transparent padding for JPEG", () => {
    render(
      <CropOverlay
        target={{ rawSrc: "asset://image.jpg", fullPath: "C:\\docs\\image.jpg", filename: "image.jpg" }}
        onApply={() => {}}
        onCancel={() => {}}
        onError={() => {}}
      />,
    );
    expect((screen.getByRole("option", { name: "透明" }) as HTMLOptionElement).disabled).toBe(true);
  });

  it("applies A4-width and independent side padding presets in source pixels", () => {
    const { container } = render(
      <CropOverlay
        target={{ rawSrc: "asset://image.png", fullPath: "C:\\docs\\image.png", filename: "image.png" }}
        a4TargetWidth={1000}
        equalPadding={20}
        onApply={() => {}}
        onCancel={() => {}}
        onError={() => {}}
      />,
    );
    const image = screen.getByAltText("image.png");
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 800 },
      naturalHeight: { configurable: true, value: 400 },
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 400 },
    });
    fireEvent.load(image);

    fireEvent.click(screen.getByRole("button", { name: "A4横幅（1000px）" }));
    let box = container.querySelector<HTMLElement>(".crop-box");
    expect(box?.style.left).toBe("-12.5%");
    expect(box?.style.width).toBe("125%");

    fireEvent.change(screen.getByLabelText("上の余白"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("右の余白"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("下の余白"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("左の余白"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "余白を適用" }));
    box = container.querySelector<HTMLElement>(".crop-box");
    expect(box?.style.left).toBe("-5%");
    expect(box?.style.top).toBe("-2.5%");
    expect(box?.style.width).toBe("107.5%");
    expect(Number.parseFloat(box?.style.height ?? "")).toBeCloseTo(110);
  });
});
