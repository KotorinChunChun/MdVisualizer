import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectImageOccurrences } from "../lib/imageOccurrences";
import { MarkdownPreview } from "./MarkdownPreview";

afterEach(cleanup);

describe("MarkdownPreview image navigation anchors", () => {
  it("表示画像のCodexボタンは同じ画像の選択位置を区別する", () => {
    const content = "![one](a.png)\n\n![two](a.png)";
    const select = vi.fn();
    render(<MarkdownPreview content={content} baseDir="C:/docs" documentPath="C:/docs/test.md" imageVersions={{}} onCodexImageSelect={select} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Codexで画像を解説・文字起こし" })[1]);
    expect(select).toHaveBeenCalledWith(content.indexOf("![two]"));
  });
  it("renders the same occurrence IDs produced by the gallery parser", () => {
    const content = "before\n\n![one](images/a.png)\n\nafter";
    const occurrences = collectImageOccurrences(content, "C:\\docs");
    const { container } = render(
      <MarkdownPreview content={content} baseDir="C:\\docs" imageVersions={{}} />,
    );

    expect(occurrences).toHaveLength(1);
    expect(container.querySelector(`[data-image-occurrence-id="${occurrences[0].id}"]`)).toBeTruthy();
  });

  it("renders Obsidian image embeds with and without an exclamation mark", () => {
    const content = "![[images/diagram.png|構成図]]\n\n[[images/photo.jpg]]";
    const occurrences = collectImageOccurrences(content, "C:\\docs");
    const { container } = render(
      <MarkdownPreview content={content} baseDir="C:\\docs" imageVersions={{}} />,
    );

    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelector('img[alt="構成図"]')).not.toBeNull();
    expect(container.querySelector('img[src*="diagram.png"]')).not.toBeNull();
    expect(container.querySelector('img[src*="photo.jpg"]')).not.toBeNull();
    expect(occurrences.map((occurrence) => occurrence.source)).toEqual([
      "images/diagram.png",
      "images/photo.jpg",
    ]);
  });

  it("preserves the loaded image DOM node when its persisted display size changes", () => {
    const imageVersions = {};
    const content = "![diagram](images/diagram.png)";
    const view = render(
      <MarkdownPreview content={content} baseDir="C:\\docs" imageVersions={imageVersions} imageDisplaySizes={{}} />,
    );
    const image = view.container.querySelector("img");

    view.rerender(
      <MarkdownPreview
        content={content}
        baseDir="C:\\docs"
        imageVersions={imageVersions}
        imageDisplaySizes={{ "images/diagram.png": { width: 320, height: 180 } }}
      />,
    );

    expect(view.container.querySelector("img")).toBe(image);
  });
});
