import { describe, expect, it } from "vitest";
import {
  clipboardImageDestination,
  clipboardImageFile,
  clipboardImageMarkdown,
  formatClipboardImageFilename,
  readClipboardImage,
  referencedStagedAssetIds,
} from "./clipboardImage";

describe("clipboardImage", () => {
  it("reads an image blob as a Base64 payload", async () => {
    await expect(readClipboardImage(new Blob([new Uint8Array([0, 1, 2])], { type: "image/png" })))
      .resolves.toEqual({ mediaType: "image/png", base64: "AAEC" });
  });

  it("uses the first numbered local PNG filename", () => {
    expect(formatClipboardImageFilename(new Date(2026, 7, 24, 9, 5, 7))).toBe("image1.png");
  });

  it("uses an empty alt for embedded clipboard data", () => {
    expect(clipboardImageMarkdown("data:image/png;base64,AAEC")).toBe("![](data:image/png;base64,AAEC)");
  });

  it("wraps paths with spaces so Markdown keeps the absolute destination intact", () => {
    expect(clipboardImageMarkdown("C:/My Images/20260824_090507.png"))
      .toBe("![](<C:/My Images/20260824_090507.png>)");
    expect(clipboardImageMarkdown("images/20260824_090507.png"))
      .toBe("![](images/20260824_090507.png)");
  });

  it("only carries an absolute folder for the absolute destination", () => {
    expect(clipboardImageDestination("absolute", " C:\\Images ")).toEqual({ destination: "absolute", absoluteDirectory: "C:\\Images" });
    expect(clipboardImageDestination("image", "C:\\Images")).toEqual({ destination: "image", absoluteDirectory: undefined });
    expect(clipboardImageDestination("fixed", "C:\\Images")).toEqual({ destination: "fixed", absoluteDirectory: undefined });
  });

  it("prefers a PNG clipboard representation over SVG and text", () => {
    const svg = new File(["<svg/>"], "image.svg", { type: "image/svg+xml" });
    const png = new File([new Uint8Array([0])], "image.png", { type: "image/png" });
    const dataTransfer = {
      items: [
        { kind: "string", type: "text/plain", getAsFile: () => null },
        { kind: "file", type: "image/svg+xml", getAsFile: () => svg },
        { kind: "file", type: "image/png", getAsFile: () => png },
      ],
      files: [],
    } as unknown as DataTransfer;
    expect(clipboardImageFile(dataTransfer)).toBe(png);
  });

  it("commits only staged assets that are still referenced by the saved Markdown", () => {
    const assets = [
      { id: "same", filename: "images/20260824_090507.png" },
      { id: "absolute", filename: "C:/My Images/20260824_090508.png" },
      { id: "undone", filename: "images/20260824_090509.png" },
    ];
    const content = [
      "![](images/20260824_090507.png)",
      "![](<C:/My Images/20260824_090508.png>)",
    ].join("\n");
    expect(referencedStagedAssetIds(content, "C:/docs", assets)).toEqual(["same", "absolute"]);
  });
});
