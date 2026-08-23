import { describe, expect, it } from "vitest";
import { clipboardImageDestination, clipboardImageMarkdown, formatClipboardImageFilename, readClipboardImage } from "./clipboardImage";

describe("clipboardImage", () => {
  it("reads an image blob as a Base64 payload", async () => {
    await expect(readClipboardImage(new Blob([new Uint8Array([0, 1, 2])], { type: "image/png" })))
      .resolves.toEqual({ mediaType: "image/png", base64: "AAEC" });
  });

  it("uses the required local timestamp filename", () => {
    expect(formatClipboardImageFilename(new Date(2026, 7, 24, 9, 5, 7))).toBe("20260824_090507.png");
  });

  it("wraps paths with spaces so Markdown keeps the absolute destination intact", () => {
    expect(clipboardImageMarkdown("C:/My Images/20260824_090507.png"))
      .toBe("![クリップボード画像](<C:/My Images/20260824_090507.png>)");
    expect(clipboardImageMarkdown("images/20260824_090507.png"))
      .toBe("![クリップボード画像](images/20260824_090507.png)");
  });

  it("only carries an absolute folder for the absolute destination", () => {
    expect(clipboardImageDestination("absolute", " C:\\Images ")).toEqual({ destination: "absolute", absoluteDirectory: "C:\\Images" });
    expect(clipboardImageDestination("images", "C:\\Images")).toEqual({ destination: "images", absoluteDirectory: undefined });
  });
});
