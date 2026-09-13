import { afterEach, describe, expect, it } from 'vitest';
import { AssetWorkspace } from './workspace';
import { configureBrowserBridge } from './browserBridge';
import { loadMarkdown, saveMarkdown } from './browserCommands';
import { encode, hasBom, decode } from './encoding';

const workspace = new AssetWorkspace();
afterEach(() => workspace.clear());
function setup(path: string, blob: Blob) {
  workspace.put(path, blob);
  configureBrowserBridge({ workspace, documentPath: () => 'index.md', updateAsset: (path, text, blob) => workspace.put(path, blob ?? new Blob([text])) });
}
describe('Web 外部ファイルの共有 command 契約', () => {
  it('Shift_JIS の外部Mermaidを読み、編集後も元の文字コードを保持する', async () => {
    setup('diagrams/a.mmd', new Blob([encode('flowchart LR\nA[開始]', 'Shift_JIS')], { type: 'text/plain' }));
    const loaded = await loadMarkdown('diagrams/a.mmd');
    expect(loaded).toMatchObject({ kind: 'mermaid', base_dir: 'diagrams/', encoding: 'Shift_JIS', content: 'flowchart LR\nA[開始]' });
    const result = await saveMarkdown({ path: loaded.path, expectedRevision: loaded.revision, content: 'flowchart LR\nA[完了]' });
    expect(result.status).toBe('saved');
    const bytes = new Uint8Array(await workspace.get(loaded.path)!.blob.arrayBuffer());
    expect(decode(bytes, 'Shift_JIS')).toBe('flowchart LR\nA[完了]');
    expect(result.status === 'saved' && result.document.revision).not.toBe(loaded.revision);
  });
  it('元ファイルが変わったら競合を返し、新しい資産を保持する', async () => {
    setup('a.drawio', new Blob(['<mxfile/>']));
    const before = await loadMarkdown('a.drawio');
    workspace.put('a.drawio', new Blob(['<mxfile modified="true"/>']));
    const result = await saveMarkdown({ path: before.path, expectedRevision: before.revision, content: '<mxfile overwritten="true"/>' });
    expect(result.status).toBe('conflict');
    expect(await workspace.get('a.drawio')!.blob.text()).toContain('modified="true"');
  });
  it('UTF-16 BE BOM を保持し、変換不能なShift_JIS更新は元ファイルを壊さない', async () => {
    setup('a.md', new Blob([encode('本文', 'UTF-16BE', true)]));
    const before = await loadMarkdown('a.md');
    await saveMarkdown({ path: before.path, expectedRevision: before.revision, content: '更新' });
    const bytes = new Uint8Array(await workspace.get('a.md')!.blob.arrayBuffer());
    expect(hasBom(bytes)).toBe(true);
    expect(decode(bytes, 'UTF-16BE')).toBe('更新');
    setup('sjis.md', new Blob([encode('本文', 'Shift_JIS')]));
    const sjis = await loadMarkdown('sjis.md');
    await expect(saveMarkdown({ path: sjis.path, expectedRevision: sjis.revision, content: '本文😀' })).rejects.toThrow('UTF-8');
    expect((await loadMarkdown(sjis.path)).content).toBe('本文');
  });
});
