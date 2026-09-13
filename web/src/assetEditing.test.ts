import { describe, expect, it } from 'vitest';
import { collectEditableMarkdownOccurrences } from '../../src/lib/markdownOccurrences';
import { applyImageEdit, applyInlineSvgEdit, convertSessionStorage, renameSessionAsset } from './assetEditing';
import type { DocumentSession } from './documentSession';

const session = (markdown: string, assets: DocumentSession['assets'] = []): DocumentSession => ({ name: 'notes/readme.md', markdown, encoding: 'UTF-8', bom: false, assets });
const fence = (value: string) => collectEditableMarkdownOccurrences(value).find(item => item.kind === 'code-fence')!;
const image = (value: string) => collectEditableMarkdownOccurrences(value).find(item => item.kind === 'image')!;

describe('browser asset editing', () => {
  it('externalizes Mermaid without overwriting an existing asset', async () => {
    const value = '```mermaid title=Flow\nflowchart LR\nA --> B\n```';
    const current = session(value);
    const next = await convertSessionStorage(current, { documentPath: current.name, storage: 'embedded', occurrence: fence(value) as never, source: 'flowchart LR\nA --> B', alt: 'Flow' });
    expect(next.assets[0]?.path).toBe('notes/Flow.mmd'); expect(next.markdown).toContain('![Flow](Flow.mmd)');
    await expect(convertSessionStorage(next, { documentPath: next.name, storage: 'embedded', occurrence: fence(value) as never, source: 'flowchart LR\nA --> B', alt: 'Flow' })).rejects.toThrow('重複');
  });
  it('identifies Mermaid from its fence even when it has no caption', async () => {
    const value = '```mermaid\nflowchart LR\nA --> B\n```'; const current = session(value);
    const next = await convertSessionStorage(current, { documentPath: current.name, storage: 'embedded', occurrence: fence(value) as never, source: 'flowchart LR\nA --> B' });
    expect(next.assets[0]?.path).toBe('notes/diagram.mmd'); expect(next.markdown).toBe('![](diagram.mmd)');
  });
  it('embeds an external table without deleting its ZIP asset', async () => {
    const value = '![data](data.csv)'; const current = session(value, [{ path: 'notes/data.csv', blob: new Blob(['a,b']) }]);
    const next = await convertSessionStorage(current, { documentPath: current.name, storage: 'external', occurrence: image(value) as never, source: 'a,b', language: 'csv' });
    expect(next.markdown).toContain('```csv'); expect(next.assets).toHaveLength(1);
  });
  it('identifies a draw.io external reference from its extension', async () => {
    const value = '![chart](diagrams/chart.drawio)'; const current = session(value, [{ path: 'notes/diagrams/chart.drawio', blob: new Blob(['<mxfile/>']) }]);
    const next = await convertSessionStorage(current, { documentPath: current.name, storage: 'external', occurrence: image(value) as never, source: '<mxfile/>', alt: 'chart' });
    expect(next.markdown).toContain('```drawio'); expect(next.markdown).toContain('<mxfile/>');
  });
  it('embeds an external text asset with a safe code fence and keeps its asset', async () => {
    const value = '![script](scripts/sample.ts)'; const current = session(value, [{ path: 'notes/scripts/sample.ts', blob: new Blob(['const marker = "```";']) }]);
    const next = await convertSessionStorage(current, { documentPath: current.name, storage: 'external', occurrence: image(value) as never, source: 'const marker = "```";', language: 'typescript' });
    expect(next.markdown).toBe('````typescript\nconst marker = "```";\n````'); expect(next.assets).toHaveLength(1);
  });
  it('renames each local Markdown reference and ignores remote images', async () => {
    const current = session('![one](img/a.png)\n![remote](https://example.test/a.png)\n![two](img/a.png)', [{ path: 'notes/img/a.png', blob: new Blob(['x']) }]);
    const next = await renameSessionAsset(current, 'img/a.png', 'b.png');
    expect(next.assets[0]?.path).toBe('notes/img/b.png'); expect(next.markdown).toBe('![one](img/b.png)\n![remote](https://example.test/a.png)\n![two](img/b.png)');
  });
  it('rejects a rename which would break a sibling Markdown asset', async () => {
    const current = session('![one](img/a.png)', [
      { path: 'notes/img/a.png', blob: new Blob(['x']) },
      { path: 'notes/other.md', blob: new Blob(['![shared](img/a.png)']) },
    ]);
    await expect(renameSessionAsset(current, 'img/a.png', 'b.png')).rejects.toThrow('別のMarkdown');
  });
  it('keeps an embedded image embedded and updates an external image as PNG', async () => {
    const png = 'data:image/png;base64,AA==';
    const embedded = session('![x](data:image/png;base64,AA==)');
    expect((await applyImageEdit(embedded, image(embedded.markdown) as never, png)).markdown).toContain(png);
    const external = session('![x](photo.jpg)', [{ path: 'notes/photo.jpg', blob: new Blob(['old'], { type: 'image/jpeg' }) }]);
    const next = await applyImageEdit(external, image(external.markdown) as never, png);
    expect(next.markdown).toContain('photo-edited.png'); expect(next.assets.map(asset => asset.path)).toContain('notes/photo-edited.png');
  });
  it('rejects a stale local image editor result and embeds a remote image result', async () => {
    const png = 'data:image/png;base64,AA==';
    const original = '![x](photo.png)'; const occurrence = image(original);
    const changed = session('![x](other.png)', [{ path: 'notes/photo.png', blob: new Blob(['old'], { type: 'image/png' }) }]);
    await expect(applyImageEdit(changed, occurrence as never, png)).rejects.toThrow();
    const remote = session('![remote](https://example.test/photo.jpg)');
    const next = await applyImageEdit(remote, image(remote.markdown) as never, png);
    expect(next.markdown).toBe(`![remote](${png})`); expect(next.assets).toHaveLength(0);
  });
  it('replaces only the verified inline SVG occurrence', () => {
    const current = session('<svg><text>old</text></svg>'); const occurrence = collectEditableMarkdownOccurrences(current.markdown).find(item => item.kind === 'inline-svg')!;
    expect(applyInlineSvgEdit(current, occurrence as never, '<svg><text>new</text></svg>').markdown).toContain('new');
  });
});
