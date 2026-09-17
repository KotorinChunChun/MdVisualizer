import { describe, expect, it } from "vitest";
import { droppedFilePath, droppedFileReference, imageAttachmentMarkdown } from "./fileAttachment";

describe("file attachment Markdown", () => {
  it("keeps the image alt empty by default and escapes a deliberate name", () => {
    expect(imageAttachmentMarkdown("C:/docs/image.png")).toBe("![](C:/docs/image.png)");
    expect(imageAttachmentMarkdown("C:/docs/image.png", "image.png")).toBe("![image.png](C:/docs/image.png)");
  });

  it.each([
    ["C:/docs/note.md", "C:/docs/image.png", "image.png"],
    ["C:/docs/note.md", "C:/docs/assets/image.png", "assets/image.png"],
    ["C:/docs/note.md", "D:/other/image.png", "D:/other/image.png"],
    ["C:/docs/note.md", "C:/other/image.png", "C:/other/image.png"],
  ])("uses a relative path only below the document folder", (documentPath, targetPath, expected) => {
    expect(droppedFileReference(documentPath, targetPath)).toBe(expected);
  });

  it("reads the native path supplied by a desktop drop", () => {
    const file = Object.assign(new File(["data"], "image.png"), { path: "C:\\docs\\image.png" });
    expect(droppedFilePath(file)).toBe("C:\\docs\\image.png");
    expect(droppedFilePath(new File(["data"], "image.png"))).toBeUndefined();
  });
});
