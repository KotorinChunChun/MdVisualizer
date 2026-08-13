import { describe, expect, it } from "vitest";
import { collectEditableMarkdownOccurrences } from "./markdownOccurrences";
import { normalizedAssetFilename, parseRasterDataUri, preferredAssetFilename, replaceImageOccurrenceSource, type AssetConversionContext } from "./assetConversion";

describe("asset conversions", () => {
  it("parses supported raster data URIs", () => {
    expect(parseRasterDataUri("data:image/jpeg;base64,QUJD")).toEqual({ mediaType: "image/jpeg", extension: "jpg", base64: "QUJD" });
    expect(parseRasterDataUri("data:image/svg+xml;base64,AAAA")).toBeNull();
  });

  it("replaces only the selected duplicate image source", () => {
    const markdown = "![one](same.png)\n![two](same.png)";
    const images = collectEditableMarkdownOccurrences(markdown).filter((item) => item.kind === "image");
    expect(replaceImageOccurrenceSource(markdown, images[1], "data:image/png;base64,AAAA"))
      .toBe("![one](same.png)\n![two](data:image/png;base64,AAAA)");
  });

  it("creates a safe preferred filename from the caption", () => {
    const occurrence = collectEditableMarkdownOccurrences("![設計 図](data:image/png;base64,AAAA)")[0];
    const context = { occurrence, assetKind: "raster", storage: "embedded", documentPath: "C:/docs/a.md" } as AssetConversionContext;
    expect(preferredAssetFilename(context, "png")).toBe("設計-図.png");
  });

  it("does not duplicate an existing image extension from the caption", () => {
    const occurrence = collectEditableMarkdownOccurrences("![screen.PNG](data:image/png;base64,AAAA)")[0];
    const context = { occurrence, assetKind: "raster", storage: "embedded", documentPath: "C:/docs/a.md" } as AssetConversionContext;
    expect(preferredAssetFilename(context, "png")).toBe("screen.png");
    expect(normalizedAssetFilename("photo.jpg", "png")).toBe("photo.png");
    expect(normalizedAssetFilename("  <>  ", ".WEBP")).toBe("image.webp");
  });
});
