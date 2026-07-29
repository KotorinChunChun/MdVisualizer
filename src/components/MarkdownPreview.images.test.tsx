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
});
