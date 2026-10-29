import { describe, expect, it } from "vitest";
import { resolveSharePointBrowserUrl, sharePointLibraryViewUrl } from "./sharePoint";

describe("SharePoint browser URLs", () => {
  const documentPath = "spmd://excelchunchun.sharepoint.com/sites/test-team-site/SpoWiki/folder/README.md";

  it("resolves a non-Markdown relative link to an HTTPS URL on the same tenant", () => {
    expect(resolveSharePointBrowserUrl("../files/spec.pdf#page=2", documentPath))
      .toBe("https://excelchunchun.sharepoint.com/sites/test-team-site/SpoWiki/files/spec.pdf#page=2");
    expect(resolveSharePointBrowserUrl("diagram.svg", documentPath))
      .toBe("https://excelchunchun.sharepoint.com/sites/test-team-site/SpoWiki/folder/diagram.svg");
  });

  it("keeps Markdown links in the app and rejects other tenants", () => {
    expect(resolveSharePointBrowserUrl("next.md", documentPath)).toBeNull();
    expect(resolveSharePointBrowserUrl("//other.sharepoint.com/sites/a/file.pdf", documentPath)).toBeNull();
    expect(resolveSharePointBrowserUrl("https://example.com/file.pdf", documentPath)).toBeNull();
  });

  it("builds the requested document-library selection URL", () => {
    expect(sharePointLibraryViewUrl("spmd://excelchunchun.sharepoint.com/sites/test-team-site/SpoWiki/README.md"))
      .toBe("https://excelchunchun.sharepoint.com/sites/test-team-site/SpoWiki/Forms/AllItems.aspx?id=%2Fsites%2Ftest%2Dteam%2Dsite%2FSpoWiki%2FREADME%2Emd&parent=%2Fsites%2Ftest%2Dteam%2Dsite%2FSpoWiki");
  });
});


describe("SharePoint root Wiki navigation", () => {
  it("keeps direct and encoded Markdown launches in document tabs", async () => {
    const { sharePointLaunchNeedsSettings } = await import("./sharePoint");
    for (const uri of ["spmd://contoso.sharepoint.com/Wiki/a.md", "spmd://contoso.sharepoint.com/Wiki/a%2Emarkdown", "C:/local.md"]) {
      expect(sharePointLaunchNeedsSettings(uri)).toBe(false);
    }
    expect(sharePointLaunchNeedsSettings("spmd://contoso.sharepoint.com/Wiki")).toBe(true);
    expect(sharePointLaunchNeedsSettings("spmd:")).toBe(true);
    expect(sharePointLaunchNeedsSettings("spmd://contoso.sharepoint.com/Wiki/%zz")).toBe(true);
  });
  it("builds the root-library view without requiring a sites prefix", () => {
    expect(sharePointLibraryViewUrl("spmd://contoso.sharepoint.com/Wiki/README.md"))
      .toBe("https://contoso.sharepoint.com/Wiki/Forms/AllItems.aspx?id=%2FWiki%2FREADME%2Emd&parent=%2FWiki");
  });
});
