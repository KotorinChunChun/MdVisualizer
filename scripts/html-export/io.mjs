import { open, realpath, rename, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const LIMITS = Object.freeze({ asset: 32 * 1024 * 1024, document: 8 * 1024 * 1024, total: 128 * 1024 * 1024, timeout: 120_000, redirects: 5 });
const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon', svg: 'image/svg+xml' };

export async function boundedFile(filename, maximum = LIMITS.asset) {
  const handle = await open(filename, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw new Error('通常ファイルではありません。');
    const chunks = []; let count = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      count += chunk.length;
      if (count > maximum) throw new Error('ファイル容量の上限を超えました。');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}

export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
}

export async function fetchBytes(source, { signal, maximum = LIMITS.asset } = {}) {
  let url = new URL(source);
  for (let count = 0; count <= LIMITS.redirects; count++) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('許可されない取得URLです。');
    const response = await fetch(url, { redirect: 'manual', signal, credentials: 'omit' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('転送先がありません。');
      const next = new URL(location, url);
      if (url.protocol === 'https:' && next.protocol !== 'https:') throw new Error('安全でない転送です。');
      url = next; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    const chunks = []; let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maximum) throw new Error('取得容量の上限を超えました。');
        chunks.push(chunk);
      }
    } catch (error) { throw new Error(error.message === '取得容量の上限を超えました。' ? error.message : '資産の取得に失敗しました。'); }
    return { bytes: Buffer.concat(chunks), mime: response.headers.get('content-type')?.split(';')[0].trim().toLowerCase(), base: url.href };
  }
  throw new Error('転送回数の上限を超えました。');
}

export function createAssetReader({ baseDir, allowRemote = false, signal }) {
  const cache = new Map(); const protectedPaths = new Set(); let total = 0;
  async function read(source, base) {
    if (typeof source !== 'string' || !source.trim() || source.length > LIMITS.asset * 2) throw new Error('資産参照が不正です。');
    const key = JSON.stringify([source, base]);
    if (cache.has(key)) return cache.get(key);
    const work = (async () => {
      signal?.throwIfAborted();
      let bytes, mime, resolved;
      if (/^data:/i.test(source)) {
        const match = /^data:([^;,]+)(;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i.exec(source);
        if (!match) throw new Error('Data URLが不正です。');
        mime = match[1].toLowerCase();
        if (match[3] && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(match[4])) throw new Error('Base64が不正です。');
        bytes = match[3] ? Buffer.from(match[4], 'base64') : Buffer.from(decodeURIComponent(match[4]), 'utf8');
        resolved = base ?? path.join(baseDir, '__inline__.svg');
      } else if (/^https?:/i.test(source) || source.startsWith('//') || (base && /^https?:/i.test(base) && !/^[a-z]:[\\/]/i.test(source))) {
        if (!allowRemote) throw new Error('外部資産には --allow-remote が必要です。');
        let fetched;
        try { fetched = await fetchBytes(new URL(source, base && /^https?:/i.test(base) ? base : 'https://localhost/').href, { signal }); }
        catch (error) { throw new Error(`外部資産を取得できません: ${error.message.includes('HTTP ') ? error.message : '取得先または通信状態を確認してください。'}`); }
        ({ bytes, mime, base: resolved } = fetched);
      } else {
        if (/^[a-z][a-z\d+.-]*:/i.test(source) && !/^[a-z]:[\\/]/i.test(source) && !/^file:/i.test(source)) throw new Error('非対応の資産参照です。');
        const filename = /^file:/i.test(source) ? fileURLToPath(source) : decodeURIComponent(source.split(/[?#]/)[0]);
        const origin = base && !/^data:/i.test(base) ? path.dirname(base) : baseDir;
        resolved = await realpath(path.resolve(origin, filename));
        protectedPaths.add(resolved.toLowerCase());
        bytes = await boundedFile(resolved);
        mime = types[path.extname(resolved).slice(1).toLowerCase()] ?? 'text/plain';
      }
      if (bytes.length > LIMITS.asset || (total += bytes.length) > LIMITS.total) throw new Error('資産の容量上限を超えました。');
      const isSvg = mime === 'image/svg+xml' || /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(bytes.subarray(0, 1024).toString('utf8'));
      if (isSvg) mime = 'image/svg+xml';
      const textual = isSvg || !mime?.startsWith('image/');
      return { base: resolved, mime, text: textual ? decodeText(bytes) : undefined, data: `data:${mime};base64,${bytes.toString('base64')}` };
    })();
    cache.set(key, work); return work;
  }
  return { read, protectedPaths };
}

export async function validateDestination(filename, { force = false, protectedPaths = new Set() } = {}) {
  if (!/\.html?$/i.test(filename)) throw new Error('出力先の拡張子は.htmlまたは.htmを指定してください。');
  const parent = await realpath(path.dirname(path.resolve(filename)));
  const target = path.join(parent, path.basename(filename));
  let existing;
  try { existing = await realpath(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (protectedPaths.has((existing ?? target).toLowerCase())) throw new Error('入力文書や参照資産を上書きできません。');
  if (existing && !force) throw new Error('出力先が存在します。上書きする場合は --force を指定してください。');
  return target;
}

export async function saveHtml(filename, html, { force = false, protectedPaths = new Set(), signal } = {}) {
  const target = await validateDestination(filename, { force, protectedPaths });
  const parent = path.dirname(target);
  if (Buffer.byteLength(html, 'utf8') > LIMITS.total) throw new Error('HTMLの容量上限を超えました。');
  signal?.throwIfAborted();
  const temporary = path.join(parent, `.html-export-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx');
    try { await handle.writeFile(html, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    signal?.throwIfAborted();
    if (force) await rename(temporary, target);
    else { await link(temporary, target); await unlink(temporary); }
    return target;
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
