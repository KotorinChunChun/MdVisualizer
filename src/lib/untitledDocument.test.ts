import { describe, expect, it, vi } from "vitest";
import type { MarkdownLoadResult } from "../types/app";
import { saveUntitledDocument } from "./untitledDocument";

const loaded = (path: string, content: string): MarkdownLoadResult => ({
  path,
  kind: "markdown",
  content,
  base_dir: "C:\\docs",
  image_paths: [],
  encoding: "UTF-8",
  size_bytes: content.length,
  modified_at: "2026-08-23 00:00",
  revision: "revision",
  source: "local",
});

describe("saveUntitledDocument", () => {
  it("returns cancellation without creating a file", async () => {
    const createDocument = vi.fn();
    const result = await saveUntitledDocument(
      { defaultPath: "無題-1.md", content: "draft", openDocumentPaths: [] },
      { choosePath: vi.fn().mockResolvedValue(null), createDocument },
    );
    expect(result).toEqual({ status: "cancelled" });
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("creates the selected Markdown with the current draft", async () => {
    const document = loaded("C:\\docs\\new.md", "draft");
    const createDocument = vi.fn().mockResolvedValue(document);
    const result = await saveUntitledDocument(
      { defaultPath: "無題-1.md", content: "draft", openDocumentPaths: ["C:\\docs\\other.md"] },
      { choosePath: vi.fn().mockResolvedValue("C:\\docs\\new.md"), createDocument },
    );
    expect(createDocument).toHaveBeenCalledWith("C:\\docs\\new.md", "draft");
    expect(result).toEqual({ status: "saved", path: "C:\\docs\\new.md", document });
  });

  it("rejects a selected path that is already open without creating it", async () => {
    const createDocument = vi.fn();
    await expect(saveUntitledDocument(
      { defaultPath: "無題-1.md", content: "draft", openDocumentPaths: ["C:\\Docs\\New.md"] },
      { choosePath: vi.fn().mockResolvedValue("c:/docs/./new.md"), createDocument },
    )).rejects.toThrow("既に別のタブ");
    expect(createDocument).not.toHaveBeenCalled();
  });
});
