import { describe, expect, it } from "vitest";
import { collectEditableMarkdownOccurrences } from "./markdownOccurrences";
import { imageOccurrenceWithCaption, normalizedAssetFilename, parseRasterDataUri, preferredAssetFilename, replaceImageOccurrenceSource, type AssetConversionContext } from "./assetConversion";

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
  it("keeps captions and titles even when they contain the same path", () => {
    for (const markdown of ['![old.png](old.png "old.png")', '<img alt="old.png" src="old.png" title="old.png">', '![a \\] old.png](<old.png> "old.png")']) {
      const image = collectEditableMarkdownOccurrences(markdown).find(item => item.kind === "image")!;
      expect(replaceImageOccurrenceSource(markdown, image, "new.png")).toBe(markdown.replace(markdown.includes("src=") ? 'src="old.png"' : markdown.includes("<old.png>") ? '<old.png>' : '(old.png', markdown.includes("src=") ? 'src="new.png"' : markdown.includes("<old.png>") ? '<new.png>' : '(new.png'));
    }
  });
  it("HTML属性内のsrc・alt風文字列とdata-srcを変更せず、実属性だけを更新する", () => {
    const markdown = '<img title=\'src="old.png" alt="旧"\' data-src="old.png" src="old.png" alt="旧">';
    const image = collectEditableMarkdownOccurrences(markdown).find(item => item.kind === "image")!;
    expect(replaceImageOccurrenceSource(markdown, image, "new.png"))
      .toBe('<img title=\'src="old.png" alt="旧"\' data-src="old.png" src="new.png" alt="旧">');
    expect(imageOccurrenceWithCaption(image, "新"))
      .toBe('<img title=\'src="old.png" alt="旧"\' data-src="old.png" src="old.png" alt="新">');
  });
  it.each([
    ['![[old.png|old.png]]', 'folder/new.png', '![[folder/new.png|old.png]]'],
    ['[[old.png]]', 'folder/new.png', '[[folder/new.png]]'],
    ['![[old.png|説明]]', 'data:image/png;base64,AAAA', '![説明](data:image/png;base64,AAAA)'],
    ['![[old.png|説明]]', 'image/a[1].png', '![説明](image/a%5B1%5D.png)'],
    ['![説明](old.png "title")', 'image/a[1](x)<y>.png', '![説明](image/a%5B1%5D%28x%29%3Cy%3E.png "title")'],
    ['![説明](<old.png> "title")', 'image/a <b>.png', '![説明](<image/a %3Cb%3E.png> "title")'],
  ])("converts %s without losing its caption or creating invalid image markup", (markdown, source, expected) => {
    const image = collectEditableMarkdownOccurrences(markdown).find(item => item.kind === "image")!;
    const changed = replaceImageOccurrenceSource(markdown, image, source);
    expect(changed).toBe(expected);
    const result = collectEditableMarkdownOccurrences(changed).find(item => item.kind === "image")!;
    expect(result).toBeDefined();
    expect(result.caption).toBe(image.caption);
    expect(decodeURIComponent(result.source)).toBe(source);
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
