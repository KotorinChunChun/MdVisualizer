import { describe, expect, it } from "vitest";
import { isMarkdownPath, localPathIdentity } from "./pathIdentity";

describe("local path identity", () => {
  it("normalizes Windows separators, dot segments, and case", () => {
    expect(localPathIdentity("C:/Docs/./Guide/../README.MD"))
      .toBe(localPathIdentity("c:\\docs\\readme.md"));
  });

  it("accepts only Markdown drop paths", () => {
    expect(isMarkdownPath("C:\\docs\\guide.md")).toBe(true);
    expect(isMarkdownPath("C:\\docs\\guide.MARKDOWN")).toBe(true);
    expect(isMarkdownPath("C:\\docs\\image.png")).toBe(false);
  });
});

