import { describe, expect, it } from "vitest";
import { resolveExpandedExportReference } from "../../packages/markdown-core/src/notionExport";

describe("expanded Notion export references", () => {
  const source = "/sites/wiki/Shared Documents/Export/Workspace abcdef/README abcdef.md";

  it("resolves encoded Markdown pages and image folders relative to the export", () => {
    expect(resolveExpandedExportReference("Project%20Notes%201234.md#Tasks", source, "https://contoso.sharepoint.com"))
      .toBe("https://contoso.sharepoint.com/sites/wiki/Shared%20Documents/Export/Workspace%20abcdef/Project%20Notes%201234.md#Tasks");
    expect(resolveExpandedExportReference("README%20abcdef/image%201.png", source, "https://contoso.sharepoint.com"))
      .toBe("https://contoso.sharepoint.com/sites/wiki/Shared%20Documents/Export/Workspace%20abcdef/README%20abcdef/image%201.png");
  });

  it("leaves page fragments and external references to their normal handlers", () => {
    expect(resolveExpandedExportReference("#section", source, "https://contoso.sharepoint.com")).toBeNull();
    expect(resolveExpandedExportReference("https://example.com/page", source, "https://contoso.sharepoint.com")).toBeNull();
  });
});
