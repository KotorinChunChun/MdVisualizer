export type Asset = { path: string; blob: Blob; url: string };
export type StoredAsset = { path: string; blob: Blob };
export const safePath = (value: string) => {
  if (/^[\\/]|[\u0000-\u001f:]/.test(value)) throw new Error("ZIP内のパスが不正です。");
  const parts = value.replace(/\\/g, "/").split("/");
  if (!parts.length || parts.some((part) => !part || part === "." || part === "..")) throw new Error("ZIP内のパスが不正です。");
  return parts.join("/");
};
export const assetBase = (name: string) => name.includes('/') ? name.slice(0, name.lastIndexOf('/') + 1) : '';
export function resolveAssetPath(source: string, base = ''): string {
  let decoded: string;
  try { decoded = decodeURIComponent(source.split(/[?#]/)[0]).replace(/\\/g, '/'); } catch { throw new Error('資産の参照パスが不正です。'); }
  if (/^[\/]|[\u0000-\u001f:]/.test(decoded)) throw new Error('資産の参照パスが不正です。');
  const parts = base.replace(/\/$/, '').split('/').filter(Boolean);
  for (const part of decoded.split('/')) {
    if (part === '..') { if (!parts.length) throw new Error('ZIPの外を参照できません。'); parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return safePath(parts.join('/'));
}
export function assetMime(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', drawio: 'application/xml', xml: 'application/xml', mmd: 'text/plain', mermaid: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values', md: 'text/markdown', markdown: 'text/markdown', json: 'application/json' } as Record<string, string>)[extension] ?? 'application/octet-stream';
}
export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('資産を読み込めません。')); reader.readAsDataURL(blob); });
}
export class AssetWorkspace {
  private assets = new Map<string, Asset>();
  clear() { this.assets.forEach((asset) => URL.revokeObjectURL(asset.url)); this.assets.clear(); }
  put(path: string, blob: Blob) { const key = safePath(path); const previous = this.assets.get(key); if (previous) URL.revokeObjectURL(previous.url); const typed = blob.type ? blob : new Blob([blob], { type: assetMime(key) }); this.assets.set(key, { path: key, blob: typed, url: URL.createObjectURL(typed) }); }
  replace(assets: StoredAsset[]) { assets.forEach(asset => safePath(asset.path)); this.clear(); assets.forEach(asset => this.put(asset.path, asset.blob)); }
  get(path: string) { return this.assets.get(safePath(path)); }
  resolve(source: string, base = "") { if (/^(?:data:|https?:|blob:|#)/i.test(source)) return source; try { return this.assets.get(resolveAssetPath(source, base))?.url ?? source; } catch { return source; } }
  entries() { return [...this.assets.values()]; }
  async readAsset(source: string, base = ''): Promise<{base: string; mime: string; data: string; text?: string}> {
    if (/^(?:data:|blob:|https?:)/i.test(source)) {
      const response = await fetch(source, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('資産を取得できません。');
      const blob = await response.blob();
      if (blob.size > 32 * 1024 * 1024) throw new Error('資産が容量上限を超えています。');
      return { base: /^https?:/i.test(source) ? new URL('.', source).href : base, mime: blob.type, data: await blobDataUrl(blob), text: /text\/|svg|xml|json/.test(blob.type) ? await blob.text() : undefined };
    }
    if (/^https?:/i.test(base)) return this.readAsset(new URL(source, base).href);
    const key = resolveAssetPath(source, base), asset = this.assets.get(key);
    if (!asset) throw new Error(`資産を見つけられません: ${key}`);
    return { base: assetBase(key), mime: asset.blob.type, data: await blobDataUrl(asset.blob), text: /text\/|svg|xml|json/.test(asset.blob.type) ? await asset.blob.text() : undefined };
  }
}
