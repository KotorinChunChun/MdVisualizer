import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageRenderer } from "./ImageRenderer";

const imageRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 320,
  bottom: 200,
  width: 320,
  height: 200,
  toJSON: () => ({}),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderImage(onStartCrop = vi.fn(), rect = imageRect, src = "photo.png") {
  vi.spyOn(HTMLImageElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);
  return {
    onStartCrop,
    ...render(
      <div className="markdown-body">
        <ImageRenderer
          src={src}
          alt="テスト画像"
          baseDir="C:\\docs"
          imageVersions={{}}
          onStartCrop={onStartCrop}
        />
      </div>,
    ),
  };
}

function ControlledImage() {
  const [displaySize, setDisplaySize] = useState<{ width: number; height: number } | null>(null);
  return (
    <div className="markdown-body">
      <ImageRenderer
        src="photo.png"
        alt="制御されたテスト画像"
        baseDir="C:\\docs"
        imageVersions={{}}
        onStartCrop={vi.fn()}
        displaySize={displaySize}
        onDisplaySizeChange={setDisplaySize}
      />
    </div>
  );
}

describe("ImageRenderer inline resize", () => {
  it("shows eight accessible resize handles after an image is loaded", () => {
    renderImage();
    fireEvent.load(screen.getByAltText("テスト画像"));

    expect(screen.getAllByRole("button")).toHaveLength(8);
    expect(screen.getByRole("button", { name: "右辺を調整" })).not.toBeNull();
  });

  it("resizes only the rendered frame and suppresses crop after a drag", () => {
    const { onStartCrop, container } = renderImage();
    const image = screen.getByAltText("テスト画像");
    fireEvent.load(image);
    fireEvent.click(image);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "拡大表示を閉じる" }));
    expect(onStartCrop).not.toHaveBeenCalled();

    const eastHandle = screen.getByRole("button", { name: "右辺を調整" });
    fireEvent.pointerDown(eastHandle, { button: 0, pointerId: 9, clientX: 100, clientY: 80 });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 50, clientY: 80 });
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 50, clientY: 80 });

    const frame = container.querySelector<HTMLElement>(".inline-image-resize")!;
    expect(frame.style.width).toBe("270px");
    expect(frame.style.height).toBe("200px");
    fireEvent.click(image);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onStartCrop).not.toHaveBeenCalled();
  });

  it("continues shrinking across pointer moves when every update is controlled", () => {
    vi.spyOn(HTMLImageElement.prototype, "getBoundingClientRect").mockReturnValue(imageRect);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);
    const { container } = render(<ControlledImage />);
    const image = screen.getByAltText("制御されたテスト画像");
    fireEvent.load(image);

    const eastHandle = screen.getByRole("button", { name: "右辺を調整" });
    fireEvent.pointerDown(eastHandle, { button: 0, pointerId: 21, clientX: 100, clientY: 80 });
    fireEvent.pointerMove(window, { pointerId: 21, clientX: 60, clientY: 80 });

    const frame = container.querySelector<HTMLElement>(".inline-image-resize")!;
    expect(frame.style.width).toBe("280px");

    fireEvent.pointerMove(window, { pointerId: 21, clientX: 20, clientY: 80 });
    expect(frame.style.width).toBe("240px");
    fireEvent.pointerUp(window, { pointerId: 21, clientX: 20, clientY: 80 });
  });

  it("keeps corner resizing proportional and supports keyboard adjustment", () => {
    const { container } = renderImage();
    fireEvent.load(screen.getByAltText("テスト画像"));

    const southEastHandle = screen.getByRole("button", { name: "右下を調整" });
    fireEvent.keyDown(southEastHandle, { key: "ArrowLeft", shiftKey: true });

    const frame = container.querySelector<HTMLElement>(".inline-image-resize")!;
    expect(frame.style.width).toBe("296px");
    expect(frame.style.height).toBe("185px");
  });

  it("does not expose resize handles for remote or data images", () => {
    const { rerender } = renderImage(vi.fn(), imageRect, "https://example.test/photo.png");
    fireEvent.load(screen.getByAltText("テスト画像"));
    expect(screen.queryAllByRole("button")).toHaveLength(0);

    rerender(<div className="markdown-body"><ImageRenderer src="data:image/png;base64,AAAA" alt="データ画像" baseDir="C:\\docs" imageVersions={{}} onStartCrop={vi.fn()} /></div>);
    fireEvent.load(screen.getByAltText("データ画像"));
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("displays local SVG files without exposing raster editing controls", () => {
    const onStartCrop = vi.fn();
    renderImage(onStartCrop, imageRect, "diagrams/architecture.svg");
    const image = screen.getByAltText("テスト画像");
    fireEvent.load(image);
    expect(image.getAttribute("src")).toContain("architecture.svg");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    fireEvent.click(image);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onStartCrop).not.toHaveBeenCalled();
  });

  it.each(["photo.png", "photo.jpeg", "photo.jpg", "photo.gif", "photo.webp", "photo.bmp"])("permits supported local raster editing for %s", (src) => {
    const onStartCrop = vi.fn();
    renderImage(onStartCrop, imageRect, src);
    const image = screen.getByAltText("テスト画像");
    fireEvent.load(image);
    expect(screen.getAllByRole("button")).toHaveLength(8);
    fireEvent.click(image);
    const previewImage = screen.getByRole("dialog").querySelector("img")!;
    fireEvent.click(previewImage);
    expect(onStartCrop).toHaveBeenCalledTimes(1);
  });

  it.each(["vector.svg", "https://example.test/photo.png", "data:image/png;base64,AAAA", "file:///C:/docs/photo.png", "photo.tiff"])("keeps non-local-raster source view-only: %s", (src) => {
    const onStartCrop = vi.fn();
    renderImage(onStartCrop, imageRect, src);
    const image = screen.getByAltText("テスト画像");
    fireEvent.load(image);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    fireEvent.click(image);
    expect(onStartCrop).not.toHaveBeenCalled();
  });

  it("keeps file URLs viewable while refusing crop editing", () => {
    const onStartCrop = vi.fn();
    renderImage(onStartCrop, imageRect, "file:///C:/docs/photo.png");
    const image = screen.getByAltText("テスト画像");
    fireEvent.load(image);
    expect(image.getAttribute("src")).toContain("file:///C:/docs/photo.png");
    fireEvent.click(image);
    expect(onStartCrop).not.toHaveBeenCalled();
  });

  it("converts a 150% display-space pointer delta back to CSS pixels and never grows past load size", () => {
    const zoomedRect = { ...imageRect, right: 480, bottom: 300, width: 480, height: 300 };
    const { container } = renderImage(vi.fn(), zoomedRect);
    const image = screen.getByAltText("テスト画像");
    fireEvent.load(image);
    const eastHandle = screen.getByRole("button", { name: "右辺を調整" });

    fireEvent.pointerDown(eastHandle, { button: 0, pointerId: 11, clientX: 150, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 11, clientX: 75, clientY: 100 });
    fireEvent.pointerUp(window, { pointerId: 11, clientX: 75, clientY: 100 });
    const frame = container.querySelector<HTMLElement>(".inline-image-resize")!;
    expect(frame.style.width).toBe("270px");

    fireEvent.pointerDown(eastHandle, { button: 0, pointerId: 12, clientX: 75, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 12, clientX: 450, clientY: 100 });
    expect(frame.style.width).toBe("320px");
  });
});
