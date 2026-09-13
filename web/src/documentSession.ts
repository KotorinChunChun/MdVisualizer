import { ZipReader, ZipWriter, BlobReader, BlobWriter, Uint8ArrayWriter, Uint8ArrayReader } from '@zip.js/zip.js';
import { decode, detectEncoding, encode, hasBom, type TextEncoding } from './encoding';
import { safePath, assetMime, type StoredAsset } from './workspace';

export interface DocumentSession { name: string; markdown: string; encoding: TextEncoding; bom: boolean; assets: StoredAsset[] }
export const WEB_LIMITS = { archive: 32 * 1024 * 1024, document: 8 * 1024 * 1024, asset: 32 * 1024 * 1024, expanded: 128 * 1024 * 1024, entries: 1000 };
export const initialSession = (): DocumentSession => ({ name: '無題.md', markdown: '# MdVisualizer Web\n\nMarkdownを開くか、ここへ入力してください。\n', encoding: 'UTF-8', bom: false, assets: [] });
function textSession(name: string, bytes: Uint8Array, assets: StoredAsset[]): DocumentSession {
  if (bytes.byteLength > WEB_LIMITS.document) throw new Error('Markdownが8 MiBを超えています。');
  const encoding = detectEncoding(bytes);
  return { name: safePath(name), markdown: decode(bytes, encoding), encoding, bom: hasBom(bytes), assets };
}
export async function importDocument(file: Blob & { name?: string }, password?: string): Promise<DocumentSession> {
  if (!/\.zip$/i.test(file.name ?? 'document.zip')) {
    if (!/\.(md|markdown)$/i.test(file.name ?? '')) throw new Error('MarkdownまたはZIPを指定してください。');
    return textSession(file.name!, new Uint8Array(await file.arrayBuffer()), []);
  }
  if (file.size > WEB_LIMITS.archive) throw new Error('ZIPが32 MiBを超えています。');
  const reader = new ZipReader(new BlobReader(file), { password, checkSignature: true });
  try {
    const entries = await reader.getEntries();
    if (entries.length > WEB_LIMITS.entries) throw new Error('ZIP内のファイル数が上限を超えています。');
    const seen = new Set<string>(); let total = 0;
    const files = entries.filter(entry => !entry.directory);
    for (const entry of entries) {
      const key = safePath(entry.filename.replace(/\/$/, ''));
      if (seen.has(key)) throw new Error('ZIP内に同じパスが重複しています。');
      seen.add(key); total += entry.uncompressedSize;
      if (entry.uncompressedSize > WEB_LIMITS.asset || total > WEB_LIMITS.expanded) throw new Error('ZIPの展開後容量が上限を超えています。');
    }
    const primary = files.find(entry => /(?:^|\/)index\.md$/i.test(entry.filename)) ?? files.find(entry => /\.(md|markdown)$/i.test(entry.filename));
    if (!primary) throw new Error('ZIPにMarkdownがありません。');
    const assets: StoredAsset[] = []; let document: Uint8Array | undefined; total = 0;
    for (const entry of files) {
      const bytes = await entry.getData(new Uint8ArrayWriter(), { checkSignature: true, onprogress: size => { if (size > WEB_LIMITS.asset) throw new Error('展開容量が上限を超えています。'); } });
      total += bytes.byteLength;
      if (total > WEB_LIMITS.expanded || bytes.byteLength !== entry.uncompressedSize) throw new Error('ZIP内の容量が不正です。');
      if (entry === primary) document = bytes;
      else assets.push({ path: safePath(entry.filename), blob: new Blob([bytes], { type: assetMime(entry.filename) }) });
    }
    return textSession(primary.filename, document!, assets);
  } finally { await reader.close(); }
}
export async function sessionZip(session: DocumentSession, password?: string): Promise<Blob> {
  const name = safePath(session.name), seen = new Set([name]);
  for (const asset of session.assets) { const key = safePath(asset.path); if (seen.has(key)) throw new Error('文書と資産の保存先が重複しています。'); seen.add(key); }
  const bytes = encode(session.markdown, session.encoding, session.bom);
  const writer = new ZipWriter(new BlobWriter('application/zip'), { password, encryptionStrength: 3, zip64: false });
  await writer.add(name, new Uint8ArrayReader(bytes));
  for (const asset of session.assets) await writer.add(asset.path, new BlobReader(asset.blob));
  return writer.close();
}
