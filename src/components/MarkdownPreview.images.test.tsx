import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { collectImageOccurrences } from "../lib/imageOccurrences";
import { MarkdownPreview } from "./MarkdownPreview";

afterEach(cleanup);

describe("MarkdownPreview image navigation anchors", () => {
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
});
