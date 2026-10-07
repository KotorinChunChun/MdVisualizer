import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { MarkdownPreview } from "./MarkdownPreview";
import { MarkdownEditor } from "./MarkdownEditor";
import { copyRasterImage } from "../lib/imageActions";

vi.mock("../lib/imageActions", async original => ({ ...await original<typeof import("../lib/imageActions")>(), copyRasterImage: vi.fn().mockResolvedValue(undefined) }));

const firstPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const secondPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf9kAAAAASUVORK5CYII=";
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("B02-M08追補: URL表記と仮画像の名前照合", () => {
  it.each([
    { source: "未確定.png", filename: "未確定.png", name: "日本語" },
    { source: "画像 1.png", filename: "画像 1.png", name: "日本語と空白" },
    { source: "進捗100%.png", filename: "進捗100%.png", name: "単独percent" },
    { source: "図%ZZ.png", filename: "図%ZZ.png", name: "URIでないpercent文字" },
    { source: "%E6%9C%AA%E7%A2%BA%E5%AE%9A.png", filename: "未確定.png", name: "符号化済みの参照" },
    { source: "images/image%201.png", filename: "images/image 1.png", name: "符号化済み空白とフォルダ" },
    { source: "図%2520資料.png", filename: "図%20資料.png", name: "文字通りのpercent20" },
    { source: "figure%2520.png", filename: "figure%20.png", name: "percent記号自体を符号化" },
  ])("$nameは未作成ファイルでなくstage画像を表示・拡大する", ({ source, filename }) => {
    const onMediaOpen = vi.fn();
    render(<MarkdownPreview content={`![仮画像](<${source}>)`} baseDir="C:/fixture" documentPath="C:/fixture/M08.md" imageVersions={{}}
      stagedAssetPreviews={{ [filename]: firstPng }} onMediaOpen={onMediaOpen} />);
    const image = screen.getByAltText("仮画像");
    expect(image.getAttribute("src")).toBe(firstPng);
    fireEvent.click(image);
    expect(onMediaOpen).toHaveBeenCalledOnce();
    expect(onMediaOpen.mock.calls[0][0].content).toMatchObject({ kind: "image", src: firstPng });
  });

  it("percent20のURIは同じ表記の原名でなく空白名の画像を指す", () => {
    render(<MarkdownPreview content="![仮画像](figure%20one.png)" baseDir="C:/fixture" documentPath="C:/fixture/M08.md" imageVersions={{}}
      stagedAssetPreviews={{ "figure%20one.png": firstPng, "figure one.png": secondPng }} />);
    expect(screen.getByAltText("仮画像").getAttribute("src")).toBe(secondPng);
  });

  it("文字通りのpercent20と空白名が共存しても二重decodeしない", () => {
    render(<MarkdownPreview content="![仮画像](figure%2520one.png)" baseDir="C:/fixture" documentPath="C:/fixture/M08.md" imageVersions={{}}
      stagedAssetPreviews={{ "figure%20one.png": firstPng, "figure one.png": secondPng }} />);
    expect(screen.getByAltText("仮画像").getAttribute("src")).toBe(firstPng);
  });

  it("同じ文書の和文空白名と文字通りpercent20名をそれぞれの画像で表示する", () => {
    render(<MarkdownPreview content="![空白名](<図 資料.png>)\n\n![percent名](図%2520資料.png)" baseDir="C:/fixture" documentPath="C:/fixture/M08.md" imageVersions={{}}
      stagedAssetPreviews={{ "図 資料.png": firstPng, "図%20資料.png": secondPng }} />);
    expect(screen.getByAltText("空白名").getAttribute("src")).toBe(firstPng);
    expect(screen.getByAltText("percent名").getAttribute("src")).toBe(secondPng);
  });

  it.each([
    { source: "未確定.png", filename: "未確定.png" },
    { source: "図%ZZ.png", filename: "図%ZZ.png" },
    { source: "図%20資料.png", filename: "図 資料.png" },
    { source: "図%2520資料.png", filename: "図%20資料.png" },
  ])("コードの図としてコピーでもURI $sourceのstageを使う", ({ source, filename }) => {
    const otherName = filename === "図 資料.png" ? "図%20資料.png" : "図 資料.png";
    const content = `![仮画像](<${source}>)`;
    const view = render(<MarkdownEditor documentId="staged-copy" documentPath="C:/fixture/M08.md" baseDir="C:/fixture" value={content}
      dirty saving={false} onChange={vi.fn()} onSave={vi.fn()} onCodexConsult={vi.fn()}
      stagedAssetPreviews={{ [otherName]: secondPng, [filename]: firstPng }} />);
    const editable = view.container.querySelector<HTMLElement>(".cm-content")!;
    const editor = EditorView.findFromDOM(editable)!;
    vi.spyOn(editor, "posAtCoords").mockReturnValue(content.indexOf(source));
    fireEvent.contextMenu(editable);
    fireEvent.click(screen.getByRole("menuitem", { name: "図としてコピー" }));
    expect(copyRasterImage).toHaveBeenCalledWith(firstPng, undefined);
  });
});
