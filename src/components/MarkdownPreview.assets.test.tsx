import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

vi.mock("./ExternalDrawioBlock", () => ({
  ExternalDrawioBlock: ({ source, onMediaOpen }: { source: string; onMediaOpen?: (target: unknown) => void }) => <button type="button" aria-label="外部SVGを拡大" onClick={() => onMediaOpen?.({ content: { kind: "svg", svg: "<svg/>" }, diagramSource: source })}>外部SVG</button>,
}));

describe("MarkdownPreview convertible assets", () => {
  afterEach(cleanup);

  it("marks Base64 raster and external SVG occurrences for conversion", () => {
    const onMediaOpen = vi.fn();
    render(<MarkdownPreview content={"![base](data:image/png;base64,AAAA)\n\n![vector](diagram.svg)"} baseDir="C:\\docs" documentPath="C:\\docs\\note.md" imageVersions={{}} onMediaOpen={onMediaOpen} />);
    fireEvent.click(screen.getByAltText("base"));
    fireEvent.click(screen.getByRole("button", { name: "外部SVGを拡大" }));
    expect(onMediaOpen.mock.calls[0][0].conversionContext).toMatchObject({ assetKind: "raster", storage: "embedded" });
    expect(onMediaOpen.mock.calls[0][0].editTarget).toMatchObject({ storage: "embedded", rawSrc: "data:image/png;base64,AAAA" });
    expect(onMediaOpen.mock.calls[1][0].conversionContext).toMatchObject({ assetKind: "svg", storage: "external" });
  });

  it("opens a safe inline SVG in its embedded conversion screen", () => {
    const onMediaOpen = vi.fn();
    const { container } = render(<MarkdownPreview content={'<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'} baseDir="C:\\docs" documentPath="C:\\docs\\note.md" imageVersions={{}} onMediaOpen={onMediaOpen} />);
    expect(screen.getByRole("img", { name: "インラインSVG" })).toBeTruthy();
    expect(container.innerHTML).not.toContain("onload");
    expect(container.innerHTML).not.toContain("script");
    fireEvent.click(screen.getByRole("button", { name: "図を拡大" }));
    expect(onMediaOpen.mock.calls[0][0]).toMatchObject({ content: { kind: "svg" }, conversionContext: { assetKind: "svg", storage: "embedded" } });
    expect(onMediaOpen.mock.calls[0][0].content.svg).not.toContain("script");
  });

  it("uses staged preview data before the external file is committed", () => {
    render(<MarkdownPreview content="![pending](image.png)" baseDir="C:\\docs" documentPath="C:\\docs\\note.md" imageVersions={{}} stagedAssetPreviews={{ "image.png": "data:image/png;base64,AAAA" }} />);
    expect(screen.getByAltText("pending").getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });

  it("renders an unsupported embedded attachment as a card and converts it back to a link", () => {
    const onTextEdit = vi.fn().mockReturnValue(true);
    render(<MarkdownPreview content="![資料](assets/report.bin)" baseDir="C:\\docs" documentPath="C:\\docs\\note.md" imageVersions={{}} onTextEdit={onTextEdit} />);
    expect(screen.getByRole("group", { name: "埋め込みファイル: report.bin" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "リンクへ切替" }));
    expect(onTextEdit).toHaveBeenCalledWith("![資料](assets/report.bin)", 0, "![資料](assets/report.bin)".length, "[資料](assets/report.bin)");
  });

  it("converts an unsupported file link to an embedded card", () => {
    const onTextEdit = vi.fn().mockReturnValue(true);
    render(<MarkdownPreview content="[資料](assets/report.bin)" baseDir="C:\\docs" documentPath="C:\\docs\\note.md" imageVersions={{}} onTextEdit={onTextEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "埋め込みへ切替" }));
    expect(onTextEdit).toHaveBeenCalledWith("[資料](assets/report.bin)", 0, "[資料](assets/report.bin)".length, "![資料](assets/report.bin)");
  });

  it("keeps file-card conversion unavailable in preview-only mode", () => {
    render(<MarkdownPreview content="![資料](assets/report.bin)" baseDir="C:\\docs" documentPath="C:\\docs\\note.md" imageVersions={{}} onTextEdit={vi.fn()} readOnly />);
    expect(screen.getByRole("group", { name: "埋め込みファイル: report.bin" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "リンクへ切替" })).toBeNull();
  });
});
