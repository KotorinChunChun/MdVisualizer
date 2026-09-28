import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
import { MediaPreviewModal } from "./MediaPreviewModal";
import { copyRasterImage } from "../lib/imageActions";

vi.mock("../lib/imageActions", async original => ({ ...await original<typeof import('../lib/imageActions')>(), copyRasterImage: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("図操作とキャプション", () => {
  it("パス・通常のフルパス・説明文をそれぞれコピーする", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<MediaPreviewModal content={{kind:'image',src:'asset://image',alt:'説明'}} onClose={vi.fn()} imageContext={{markdownPath:'C:/docs/a.md',imagePath:String.raw`\\?\C:\docs\images\a.png`,source:'images/a.png',sourceOffset:0,caption:'説明'}} />);
    for (const [label, expected] of [['画像のパスをコピー','images/a.png'],['画像のフルパスをコピー',String.raw`C:\docs\images\a.png`],['画像の説明文をコピー','説明']]) {
      fireEvent.click(screen.getByRole('button',{name:'コピー形式を選択'}));
      fireEvent.click(screen.getByRole('button',{name:label}));
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expected));
    }
  });
  it("埋込・空説明のコピーを理由付きで無効にする", () => {
    render(<MediaPreviewModal content={{kind:'image',src:'data:image/png;base64,AAAA',alt:''}} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button',{name:'コピー形式を選択'}));
    for (const label of ['画像のパスをコピー','画像のフルパスをコピー','画像の説明文をコピー']) {
      const button=screen.getByRole('button',{name:label}) as HTMLButtonElement;
      expect(button.disabled).toBe(true); expect(button.title).not.toBe('');
    }
  });
  it.each([['![図](a.png)', '埋め込みに変換'], ['![図](data:image/png;base64,AAAA)', 'ファイルへ変換']])("%sの右クリックは図コピーと格納形態変換", async (content, label) => {
    const convert = vi.fn();
    render(<MarkdownPreview content={content} documentPath="C:/docs/test.md" baseDir="C:/docs" imageVersions={{}} allowBlockActions readOnly onAssetStorageConvert={convert} />);
    fireEvent.contextMenu(screen.getByRole('img', {name:'図'}));
    expect(screen.queryByRole('menuitem', {name:'プレーンテキストでコピー'})).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', {name:'図としてコピー'}));
    await waitFor(() => expect(copyRasterImage).toHaveBeenCalledOnce());
    fireEvent.contextMenu(screen.getByRole('img', {name:'図'}));
    fireEvent.click(screen.getByRole('menuitem', {name:label}));
    expect(convert).toHaveBeenCalledOnce();
  });
  it.each(['説明',''])("閲覧中のキャプション「%s」を編集し、本文は読取専用を保つ", caption => {
    const source=`本文\n\n![${caption}](a.png)`; const edit=vi.fn().mockReturnValue(true);
    const {container}=render(<MarkdownPreview content={source} baseDir="C:/docs" imageVersions={{}} readOnly allowBlockActions onTextEdit={edit} />);
    fireEvent.doubleClick(screen.getByText('本文'));
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.doubleClick(container.querySelector('.inline-image-resize__caption')!);
    const input=screen.getByRole('textbox', {name:'プレビューのテキストを編集'});
    fireEvent.change(input,{target:{value:'変更'}});fireEvent.keyDown(input,{key:'Enter'});
    expect(edit).toHaveBeenCalledWith(source,source.indexOf('![')+2,source.indexOf(']'), '変更');
  });
  it("拡大表示にコピー群がありペイントはない", () => {
    render(<MediaPreviewModal content={{kind:'image',src:'data:image/png;base64,AAAA',alt:'図'}} onClose={vi.fn()} imageApps={[{id:'paint',label:'ペイント',executable:'mspaint.exe',args:[]} as never]} onOpenImageApp={vi.fn()} />);
    expect(screen.queryByRole('button',{name:'ペイント'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'コピー形式を選択'}));
    for(const name of ['図としてコピー','画像ファイルとしてコピー','コードをMarkdownでコピー','画像のパスをコピー']) expect(screen.getByRole('button',{name})).toBeTruthy();
  });
});
