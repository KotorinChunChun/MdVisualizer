import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageGallery, type ImageGalleryItem } from "./ImageGallery";

const items: ImageGalleryItem[] = [
  {
    path: "C:\\docs\\diagram.png",
    src: "asset://diagram.png",
    filename: "diagram.png",
    occurrences: [
      { id: "image-1", caption: "概要図", sourceLine: 12 },
      { id: "image-2", caption: "", sourceLine: 38 },
    ],
  },
  {
    path: "C:\\docs\\photo.png",
    src: "asset://photo.png",
    filename: "photo.png",
    occurrences: [{ id: "image-3", caption: "写真", sourceLine: 55 }],
  },
];

describe("ImageGallery", () => {
  afterEach(cleanup);

  it("lists one image card per file with its thumbnail and occurrence count", () => {
    const { container } = render(<ImageGallery items={items} onJump={vi.fn()} defaultOpen />);

    expect(container.querySelectorAll(".image-gallery-card__thumbnail")).toHaveLength(2);
    expect(container.querySelector<HTMLImageElement>(".image-gallery-card__thumbnail")?.src).toContain("asset://diagram.png");
    expect(screen.getByText("diagram.png")).toBeTruthy();
    expect(screen.getByText("概要図")).toBeTruthy();
    expect(screen.getByText("2 箇所")).toBeTruthy();
    expect(screen.getByText("photo.png")).toBeTruthy();
    expect(screen.getByText("1 箇所")).toBeTruthy();
  });

  it("renders reusable content without a second panel shell when embedded", () => {
    const { container } = render(<ImageGallery items={items} onJump={vi.fn()} isOpen embedded />);
    expect(container.querySelector(".image-gallery--embedded")).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "画像ギャラリーの一覧" })).toBeNull();
    expect(screen.getByText("概要図")).toBeTruthy();
  });

  it("expands a card and jumps to the selected occurrence", () => {
    const onJump = vi.fn();
    render(<ImageGallery items={items} activeOccurrenceId="image-2" onJump={onJump} defaultOpen />);

    fireEvent.click(screen.getByRole("button", { name: /diagram\.png/ }));
    const firstOccurrence = screen.getByRole("button", { name: /概要図.*12行目/ });
    fireEvent.click(firstOccurrence);

    expect(onJump).toHaveBeenCalledWith("image-1");
    expect(screen.getByRole("button", { name: /キャプションなし.*38行目/ }).getAttribute("aria-current")).toBe("location");
  });

  it("opens and closes the panel with accessible controls", () => {
    const onOpenChange = vi.fn();
    render(<ImageGallery items={items} onJump={vi.fn()} onOpenChange={onOpenChange} />);

    const toggle = screen.getByRole("button", { name: "画像ギャラリー" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("complementary", { name: "画像ギャラリーの一覧" })).toBeTruthy();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "ギャラリーパネルを閉じる" }));
    expect(screen.queryByRole("complementary", { name: "画像ギャラリーの一覧" })).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("uses only the owning layout's controls when visibility is controlled", () => {
    render(<ImageGallery items={items} activeOccurrenceId="image-1" onJump={vi.fn()} isOpen onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "画像ギャラリー" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "画像ギャラリーの一覧" })).toBeTruthy();
  });
});
