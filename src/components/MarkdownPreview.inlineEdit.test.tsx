import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview direct text editing", () => {
  afterEach(cleanup);

  it("opens an input for rendered text and preserves link syntax in the requested source range", () => {
    const source = "# 見出し\n\n[同じ](https://example.test)";
    const onTextEdit = vi.fn().mockReturnValue(true);
    render(<MarkdownPreview content={source} baseDir="" imageVersions={{}} onTextEdit={onTextEdit} />);
    fireEvent.doubleClick(screen.getByText("同じ"));
    const input = screen.getByRole("textbox", { name: "プレビューのテキストを編集" });
    fireEvent.change(input, { target: { value: "変更" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onTextEdit).toHaveBeenCalledWith(source, source.indexOf("同じ"), source.indexOf("同じ") + 2, "変更");
  });

  it("does not toggle a heading when its text is selected or double-clicked", () => {
    const source = "# 見出し\n\n本文";
    render(<MarkdownPreview content={source} baseDir="" imageVersions={{}} onTextEdit={vi.fn().mockReturnValue(true)} />);
    const toggle = screen.getByRole("button", { name: /見出しを折りたたむ/ });
    fireEvent.doubleClick(screen.getByText("見出し"));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("does not enable direct editing in static previews", () => {
    render(<MarkdownPreview content="本文" baseDir="" imageVersions={{}} staticMode onTextEdit={vi.fn()} />);
    fireEvent.doubleClick(screen.getByText("本文"));
    expect(screen.queryByRole("textbox", { name: "プレビューのテキストを編集" })).toBeNull();
  });

  it("edits PNG ALT on double click without opening the image", () => {
    const source = "![写真](photo.png)";
    const onTextEdit = vi.fn().mockReturnValue(true);
    render(<MarkdownPreview content={source} baseDir="C:/docs" imageVersions={{}} onTextEdit={onTextEdit} onMediaOpen={vi.fn()} />);
    fireEvent.doubleClick(screen.getByRole("button", { name: "写真" }));
    expect(screen.getByRole("textbox", { name: "プレビューのテキストを編集" })).toBeTruthy();
    expect(onTextEdit).not.toHaveBeenCalled();
  });

  it("edits inline code and keeps shortcut SVG and color swatch rendering", () => {
    const source = "`code` と `Ctrl + X` と `#aabbcc`";
    const onTextEdit = vi.fn().mockReturnValue(true);
    render(<MarkdownPreview content={source} baseDir="" imageVersions={{}} onTextEdit={onTextEdit} />);
    fireEvent.doubleClick(screen.getByText("code"));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "プレビューのテキストを編集" }), { key: "Enter" });
    expect(onTextEdit).toHaveBeenCalledWith(source, 1, 5, "code");
    const shortcut = screen.getByRole("img", { name: "キーボードショートカット: Ctrl + X" });
    expect(shortcut.getAttribute("data-shortcut-source")).toBe("Ctrl + X");
    fireEvent.doubleClick(shortcut);
    expect(screen.getByRole("textbox", { name: "プレビューのテキストを編集" })).toBeTruthy();
    expect(document.querySelector(".markdown-inline-code__color-swatch")).not.toBeNull();
  });
  it("preserves single link clicks and cancels both clicks before inline editing", () => {
    vi.useFakeTimers();
    try {
      const open = vi.fn();
      const source = "[リンク](next.md)";
      const view = render(<MarkdownPreview content={source} baseDir="C:/docs" imageVersions={{}} onTextEdit={vi.fn()} onOpenDocument={open} />);
      const linkText = screen.getByText("リンク");
      fireEvent.click(linkText, { detail: 1 });
      fireEvent.click(linkText, { detail: 2 });
      fireEvent.doubleClick(linkText);
      vi.advanceTimersByTime(400);
      expect(open).not.toHaveBeenCalled();
      expect(screen.getByRole("textbox", { name: "プレビューのテキストを編集" })).toBeTruthy();
      view.unmount();
      render(<MarkdownPreview content={source} baseDir="C:/docs" imageVersions={{}} onOpenDocument={open} />);
      fireEvent.click(screen.getByText("リンク"));
      expect(open).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it("cancels both pending image clicks when editing ALT", () => {
    vi.useFakeTimers();
    try {
      const open = vi.fn();
      render(<MarkdownPreview content="![写真](photo.png)" baseDir="C:/docs" imageVersions={{}} onTextEdit={vi.fn()} onMediaOpen={open} />);
      const image = screen.getByRole("button", { name: "写真" });
      fireEvent.click(image, { detail: 1 });
      fireEvent.click(image, { detail: 2 });
      fireEvent.doubleClick(image);
      vi.advanceTimersByTime(400);
      expect(open).not.toHaveBeenCalled();
      expect(screen.getByRole("textbox", { name: "プレビューのテキストを編集" })).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });
});
