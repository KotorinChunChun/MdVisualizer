import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

import { isAbsoluteLocalPath, isWindowsAbsolutePath, resolveImageSrc, resolveLocalMarkdownPath } from "./path";

describe("Windows image paths", () => {
  it.each(["C:/images/a.png", "C:\\images\\a.png", "z:/x/y.png"])("recognizes %s as an absolute Windows path", (path) => {
    expect(isWindowsAbsolutePath(path)).toBe(true);
    expect(isAbsoluteLocalPath(path)).toBe(true);
  });

  it("does not prepend baseDir to a drive path written with forward slashes", () => {
    expect(resolveImageSrc("C:/images/a.png", "C:\\docs")).toBe("asset://C:/images/a.png");
  });

  it("keeps file URLs directly viewable without treating them as local paths", () => {
    expect(resolveImageSrc("file:///C:/images/a.png", "C:\\docs")).toBe("file:///C:/images/a.png");
  });

  it("resolves relative and tauri.localhost Markdown links inside the document directory", () => {
    expect(resolveLocalMarkdownPath("../guide/next.md", "C:\\docs\\current")).toBe("C:/docs/guide/next.md");
    expect(resolveLocalMarkdownPath("http://tauri.localhost/v0.1.0-imp.md", "C:\\docs")).toBe("C:/docs/v0.1.0-imp.md");
    expect(resolveLocalMarkdownPath("http://tauri.localhost/?/C:/docs/local-links.md", "C:\\ignored")).toBe("C:/docs/local-links.md");
    expect(resolveLocalMarkdownPath("/?/C:/docs/local-links.md", "C:\\ignored")).toBe("C:/docs/local-links.md");
    expect(resolveLocalMarkdownPath("/%3F/C:/docs/local-links.md", "C:\\ignored")).toBe("C:/docs/local-links.md");
  });

  it("does not classify external or non-Markdown links as local documents", () => {
    expect(resolveLocalMarkdownPath("https://example.com/readme.md", "C:\\docs")).toBeNull();
    expect(resolveLocalMarkdownPath("image.png", "C:\\docs")).toBeNull();
  });
});
