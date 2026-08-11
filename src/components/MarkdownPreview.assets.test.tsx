import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview convertible assets", () => {
  afterEach(cleanup);

  it("marks Base64 raster and external SVG occurrences for conversion", () => {
    const onMediaOpen = vi.fn();
    render(<MarkdownPreview content={"![base](data:image/png;base64,AAAA)\n\n![vector](diagram.svg)"} baseDir="C:\\docs" documentPath="C:\\docs\\note.md" imageVersions={{}} onMediaOpen={onMediaOpen} />);
    fireEvent.click(screen.getByAltText("base"));
    fireEvent.click(screen.getByAltText("vector"));
    expect(onMediaOpen.mock.calls[0][0].conversionContext).toMatchObject({ assetKind: "raster", storage: "embedded" });
    expect(onMediaOpen.mock.calls[1][0].conversionContext).toMatchObject({ assetKind: "svg", storage: "external" });
  });

  it("opens a safe inline SVG in its embedded conversion screen", () => {
    const onMediaOpen = vi.fn();
    const { container } = render(<MarkdownPreview content={'<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'} baseDir="C:\\docs" documentPath="C:\\docs\\note.md" imageVersions={{}} onMediaOpen={onMediaOpen} />);
    const svgPreview = screen.getByRole("img", { name: "インラインSVG" });
    expect(container.innerHTML).not.toContain("onload");
    fireEvent.click(svgPreview);
    expect(onMediaOpen.mock.calls[0][0]).toMatchObject({ content: { kind: "svg" }, conversionContext: { assetKind: "svg", storage: "embedded" } });
    expect(onMediaOpen.mock.calls[0][0].content.svg).not.toContain("script");
  });

  it("uses staged preview data before the external file is committed", () => {
    render(<MarkdownPreview content="![pending](image.png)" baseDir="C:\\docs" documentPath="C:\\docs\\note.md" imageVersions={{}} stagedAssetPreviews={{ "image.png": "data:image/png;base64,AAAA" }} />);
    expect(screen.getByAltText("pending").getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });
});
