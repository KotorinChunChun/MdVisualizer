import { describe, expect, it } from "vitest";
import { displayDocumentPath, documentSourceIdentity, isMarkdownPath, isSupportedDocumentPath, localPathIdentity } from "./pathIdentity";

describe("local path identity", () => {
  it("拡張パスのドライブとUNCを通常表記と同一視する", () => {
    for (const [extended, normal] of [[String.raw`\\?\C:\図\a.md`, String.raw`C:\図\a.md`], [String.raw`\\?\UNC\server\share\a.md`, String.raw`\\server\share\a.md`]]) {
      expect(displayDocumentPath(extended)).toBe(normal);
      expect(documentSourceIdentity(extended)).toBe(documentSourceIdentity(normal));
    }
    expect(displayDocumentPath("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(displayDocumentPath("/tmp/a.md")).toBe("/tmp/a.md");
  });
  it("normalizes Windows separators, dot segments, and case", () => {
    expect(localPathIdentity("C:/Docs/./Guide/../README.MD"))
      .toBe(localPathIdentity("c:\\docs\\readme.md"));
  });

  it("accepts only Markdown drop paths", () => {
    expect(isMarkdownPath("C:\\docs\\guide.md")).toBe(true);
    expect(isMarkdownPath("C:\\docs\\guide.MARKDOWN")).toBe(true);
    expect(isMarkdownPath("C:\\docs\\image.png")).toBe(false);
  });

  it("accepts every directly viewable document path", () => {
    for (const path of ["guide.md", "guide.markdown", "diagram.svg", "flow.mmd", "flow.MERMAID", "system.DRAWIO"]) {
      expect(isSupportedDocumentPath(path)).toBe(true);
    }
    expect(isSupportedDocumentPath("image.png")).toBe(false);
  });

  it("deduplicates spmd hosts and paths case-insensitively", () => {
    expect(documentSourceIdentity("SPMD://CONTOSO.sharepoint.com/sites/Docs/Shared/README.md"))
      .toBe(documentSourceIdentity("spmd://contoso.sharepoint.com/sites/docs/shared/readme.md"));
  });
});
