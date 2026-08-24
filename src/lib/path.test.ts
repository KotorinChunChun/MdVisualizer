import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

import { isAbsoluteLocalPath, isWindowsAbsolutePath, resolveImageSrc, resolveLocalDocumentPath, resolveLocalImagePath, resolveLocalMarkdownPath, resolveSharePointDocumentPath, stripWindowsExtendedPathPrefix } from "./path";

describe("Windows image paths", () => {
  it("converts extended-length paths to regular local and UNC paths", () => {
    expect(stripWindowsExtendedPathPrefix(String.raw`\\?\C:\docs\sample.md`)).toBe(String.raw`C:\docs\sample.md`);
    expect(stripWindowsExtendedPathPrefix(String.raw`\\?\UNC\server\share\sample.md`)).toBe(String.raw`\\server\share\sample.md`);
  });

  it.each(["C:/images/a.png", "C:\\images\\a.png", "z:/x/y.png"])("recognizes %s as an absolute Windows path", (path) => {
    expect(isWindowsAbsolutePath(path)).toBe(true);
    expect(isAbsoluteLocalPath(path)).toBe(true);
  });

  it("does not prepend baseDir to a drive path written with forward slashes", () => {
    expect(resolveImageSrc("C:/images/a.png", "C:\\docs")).toBe("asset://C:/images/a.png");
  });

  it("normalizes canonical Windows extended-length paths", () => {
    const imagePath = "\\\\?\\C:\\images\\sample.svg";
    expect(isWindowsAbsolutePath(imagePath)).toBe(true);
    expect(isAbsoluteLocalPath(imagePath)).toBe(true);
    expect(resolveImageSrc(imagePath, "\\\\?\\C:\\ignored")).toBe("asset://C:/images/sample.svg");
    expect(resolveLocalImagePath(imagePath, "C:\\ignored")).toBe("C:/images/sample.svg");
    expect(resolveLocalDocumentPath(imagePath, "C:\\ignored")).toBe("C:/images/sample.svg");
  });

  it("normalizes a canonical base directory when resolving relative images", () => {
    expect(resolveImageSrc("images/a.png", "\\\\?\\C:\\docs"))
      .toBe("asset://C:/docs/images/a.png");
  });

  it("keeps file URLs directly viewable without treating them as local paths", () => {
    expect(resolveImageSrc("file:///C:/images/a.png", "C:\\docs")).toBe("file:///C:/images/a.png");
  });

  it("resolves URL-encoded Notion export links and relative image folders", () => {
    expect(resolveLocalDocumentPath("Project%20Notes%20abcdef1234567890abcdef1234567890.md", "C:\\exports\\Workspace"))
      .toBe("C:/exports/Workspace/Project Notes abcdef1234567890abcdef1234567890.md");
    expect(resolveImageSrc("Project%20Notes%20abcdef/image%201.png", "C:\\exports\\Workspace"))
      .toBe("asset://C:/exports/Workspace/Project Notes abcdef/image 1.png");
  });

  it("resolves relative and tauri.localhost Markdown links inside the document directory", () => {
    expect(resolveLocalMarkdownPath("../guide/next.md", "C:\\docs\\current")).toBe("C:/docs/guide/next.md");
    expect(resolveLocalMarkdownPath("http://tauri.localhost/v0.0.1-imp.md", "C:\\docs")).toBe("C:/docs/v0.0.1-imp.md");
    expect(resolveLocalMarkdownPath("http://tauri.localhost/?/C:/docs/local-links.md", "C:\\ignored")).toBe("C:/docs/local-links.md");
    expect(resolveLocalMarkdownPath("/?/C:/docs/local-links.md", "C:\\ignored")).toBe("C:/docs/local-links.md");
    expect(resolveLocalMarkdownPath("/%3F/C:/docs/local-links.md", "C:\\ignored")).toBe("C:/docs/local-links.md");
  });

  it("does not classify external or non-Markdown links as local documents", () => {
    expect(resolveLocalMarkdownPath("https://example.com/readme.md", "C:\\docs")).toBeNull();
    expect(resolveLocalMarkdownPath("image.png", "C:\\docs")).toBeNull();
  });

  it("resolves SVG and Mermaid links as local documents", () => {
    expect(resolveLocalDocumentPath("../diagrams/system.svg", "C:\\docs\\current")).toBe("C:/docs/diagrams/system.svg");
    expect(resolveLocalDocumentPath("flow.mmd", "C:\\docs")).toBe("C:/docs/flow.mmd");
    expect(resolveLocalDocumentPath("sequence.mermaid#ignored", "C:\\docs")).toBe("C:/docs/sequence.mermaid");
  });

  it("resolves SharePoint Markdown links and removes fragments", () => {
    const source = "spmd://contoso.sharepoint.com/sites/manual/Shared%20Documents/guide/index.md";
    expect(resolveSharePointDocumentPath("../README.md#setup", source))
      .toBe("spmd://contoso.sharepoint.com/sites/manual/Shared%20Documents/README.md");
    expect(resolveSharePointDocumentPath("spmd://contoso.sharepoint.com/sites/manual/docs/a.md"))
      .toBe("spmd://contoso.sharepoint.com/sites/manual/docs/a.md");
    expect(resolveSharePointDocumentPath("spmd://evil.example/sites/manual/docs/a.md")).toBeNull();
    expect(resolveSharePointDocumentPath("a.md?token=secret", source)).toBeNull();
    expect(resolveLocalDocumentPath("spmd://evil.example/sites/manual/docs/a.md", "C:\\docs")).toBeNull();
    expect(resolveSharePointDocumentPath("diagram.svg", source)).toBeNull();
  });
});
