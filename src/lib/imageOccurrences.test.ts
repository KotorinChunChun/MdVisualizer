import { describe, expect, it } from "vitest";
import { collectImageOccurrences, groupImageOccurrences } from "./imageOccurrences";

describe("image occurrences", () => {
  it("collects Markdown and HTML images with stable source positions", () => {
    const markdown = [
      "# Images",
      "",
      "![最初](images/shared.png)",
      "",
      '<img src="images/shared.png" alt="二番目">',
      "",
      "![外部](https://example.com/remote.png)",
    ].join("\n");
    const occurrences = collectImageOccurrences(markdown, "C:\\docs");

    expect(occurrences.map((item) => ({
      id: item.id,
      path: item.localPath,
      caption: item.caption,
      line: item.sourceLine,
    }))).toEqual([
      { id: "markdown-image-10", path: "C:/docs/images/shared.png", caption: "最初", line: 3 },
      { id: "markdown-image-36", path: "C:/docs/images/shared.png", caption: "二番目", line: 5 },
      { id: "markdown-image-77", path: null, caption: "外部", line: 7 },
    ]);
  });

  it("groups duplicate local references while preserving occurrence order", () => {
    const occurrences = collectImageOccurrences(
      "![one](./images/a.png)\n\n![two](images/a.png)",
      "C:\\docs",
    );
    const groups = groupImageOccurrences(occurrences);

    expect(groups).toHaveLength(1);
    expect(groups[0].filename).toBe("a.png");
    expect(groups[0].occurrences.map((item) => item.caption)).toEqual(["one", "two"]);
  });
});
