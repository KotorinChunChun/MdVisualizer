import { describe, expect, it } from 'vitest';
import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js';
import { importDocument, sessionZip, type DocumentSession } from './documentSession';
import { decode, encode, hasBom } from './encoding';
import { AssetWorkspace, assetBase, resolveAssetPath, safePath } from './workspace';

describe('文書と相対資産の保存安全性', () => {
  for (const encoding of ['UTF-16LE', 'UTF-16BE'] as const) {
    it(`BOMなし${encoding}のMarkdownを保存後に再読込できる`, async () => {
      const session: DocumentSession = { name: '本文.md', markdown: '# 日本語\r\n\r\n本文と表\r\n', encoding, bom: false, assets: [] };
      const restored = await importDocument(await sessionZip(session));
      expect(restored.markdown).toBe(session.markdown);
      expect(restored.encoding).toBe(encoding);
      expect(restored.bom).toBe(false);
    });
  }
  for (const encoding of ['UTF-8', 'UTF-16LE', 'UTF-16BE', 'Shift_JIS'] as const) {
    it(`${encoding}の文書・BOM・相対画像をZIPで保持する`, async () => {
      const session: DocumentSession = { name: 'folder/note.md', markdown: '# 日本語\r\n\r\n![画像](../images/a.png)\r\n', encoding, bom: encoding !== 'Shift_JIS', assets: [{ path: 'images/a.png', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) }] };
      const next = await importDocument(await sessionZip(session));
      expect(next.name).toBe(session.name); expect(next.markdown).toBe(session.markdown); expect(next.encoding).toBe(encoding); expect(next.bom).toBe(session.bom);
      expect(next.assets[0].path).toBe('images/a.png'); expect(new Uint8Array(await next.assets[0].blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
      const workspace = new AssetWorkspace(); workspace.replace(next.assets);
      expect(workspace.resolve('../images/a.png', assetBase(next.name))).toMatch(/^blob:/); workspace.clear();
    });
  }
  it('暗号化ZIPは画像も含め、誤ったパスワードでは文書を返さない', async () => {
    const session: DocumentSession = { name: 'note.md', markdown: '# secret', encoding: 'UTF-8', bom: false, assets: [{ path: 'a.png', blob: new Blob(['private image']) }] };
    const blob = await sessionZip(session, 'テスト-only-password');
    await expect(importDocument(blob, 'wrong')).rejects.toThrow();
    const next = await importDocument(blob, 'テスト-only-password'); expect(next.markdown).toBe(session.markdown); expect(await next.assets[0].blob.text()).toBe('private image');
  });
  for (const encoding of ['Shift_JIS', 'UTF-16LE', 'UTF-16BE'] as const) {
    it(`暗号化ZIPで${encoding}の文書と画像を同時に往復する`, async () => {
      const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10, 0x80]);
      const session: DocumentSession = {
        name: '資料/本文.md',
        markdown: '# 日本語の資料\r\n\r\n![画像](../画像/図.png)\r\n',
        encoding,
        bom: encoding !== 'Shift_JIS',
        assets: [{ path: '画像/図.png', blob: new Blob([imageBytes], { type: 'image/png' }) }],
      };
      const password = 'browser-zip-test';
      const archive = await sessionZip(session, password);

      await expect(importDocument(archive, 'wrong-password')).rejects.toThrow();
      const restored = await importDocument(archive, password);
      expect(restored.name).toBe(session.name);
      expect(restored.markdown).toBe(session.markdown);
      expect(restored.encoding).toBe(encoding);
      expect(restored.bom).toBe(session.bom);
      expect(restored.assets).toHaveLength(1);
      expect(restored.assets[0].path).toBe('画像/図.png');
      expect(restored.assets[0].blob.type).toBe('image/png');
      expect(new Uint8Array(await restored.assets[0].blob.arrayBuffer())).toEqual(imageBytes);
    });
  }
  it('ZIPの絶対パスと階層逸脱を拒否する', async () => {
    for (const path of ['/a.md', '../a.md', 'C:/a.md', 'a//b.md']) expect(() => safePath(path)).toThrow();
    expect(resolveAssetPath('../a.png', 'docs/')).toBe('a.png'); expect(() => resolveAssetPath('../../a.png', 'docs/')).toThrow();
    const writer = new ZipWriter(new BlobWriter()); await writer.add('../note.md', new BlobReader(new Blob(['secret'])));
    await expect(importDocument(await writer.close())).rejects.toThrow();
  });
  it('変換不能文字をShift_JIS保存で失わない', () => {
    expect(() => encode('絵文字😀', 'Shift_JIS')).toThrow(/UTF-8/);
    const bytes = encode('本文\r\n', 'UTF-8', true); expect(hasBom(bytes)).toBe(true); expect(decode(bytes, 'UTF-8')).toBe('本文\r\n');
  });
});
