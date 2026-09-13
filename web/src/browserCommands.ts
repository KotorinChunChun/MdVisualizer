import { assetBase, assetMime, blobDataUrl, resolveAssetPath, safePath } from "./workspace";
import { browserBridge } from "./browserBridge";
import { decode, detectEncoding, encode, hasBom } from "./encoding";
import type { DocumentAssetData, MarkdownLoadResult, MarkdownSaveResult, SaveMarkdownRequest } from "../../src/types/app";

const textKinds = /^(?:text\/|image\/svg\+xml|application\/(?:json|xml))/i;
const revisions = new WeakMap<Blob, string>();
let nextRevision = 0;
function revision(blob: Blob): string {
  let value = revisions.get(blob);
  if (!value) { value = `web:${++nextRevision}`; revisions.set(blob, value); }
  return value;
}
function assetAt(path: string) {
  const asset = browserBridge().workspace.get(safePath(path));
  if (!asset) throw new Error(`資産を見つけられません: ${path}`);
  return asset;
}
export async function readDocumentAsset(documentPath: string, source: string): Promise<DocumentAssetData> {
  const path = resolveAssetPath(source, assetBase(documentPath)), asset = assetAt(path);
  const mediaType = asset.blob.type && asset.blob.type !== 'application/octet-stream' ? asset.blob.type : assetMime(path);
  const bytes = new Uint8Array(await asset.blob.arrayBuffer());
  return { filename: path.split('/').pop()!, path, mediaType, text: textKinds.test(mediaType) ? decode(bytes, detectEncoding(bytes)) : null, base64: (await blobDataUrl(asset.blob)).split(',')[1], revision: revision(asset.blob), source: 'local', canEdit: true };
}
export async function loadMarkdown(path: string): Promise<MarkdownLoadResult> {
  const asset = assetAt(path), bytes = new Uint8Array(await asset.blob.arrayBuffer()), encoding = detectEncoding(bytes);
  return { path, kind: /\.(?:mmd|mermaid)$/i.test(path) ? 'mermaid' : /\.drawio$/i.test(path) ? 'drawio' : /\.svg$/i.test(path) ? 'svg' : /\.(?:csv|tsv)$/i.test(path) ? 'tsv' : 'markdown', content: decode(bytes, encoding), revision: revision(asset.blob), base_dir: assetBase(path), image_paths: [], encoding, size_bytes: bytes.byteLength, modified_at: '', source: 'local' };
}
export async function saveMarkdown(request: SaveMarkdownRequest): Promise<MarkdownSaveResult> {
  const bridge = browserBridge(), original = assetAt(request.path).blob;
  const bytes = new Uint8Array(await original.arrayBuffer());
  // ダイアログを開いてから別の編集が入った場合、その更新を上書きしない。
  if (request.expectedRevision !== revision(original) || assetAt(request.path).blob !== original) return { status: 'conflict', latest: await loadMarkdown(request.path) };
  const blob = new Blob([encode(request.content, detectEncoding(bytes), hasBom(bytes))], { type: original.type });
  bridge.updateAsset(request.path, request.content, blob);
  // React の再描画前でも、次の読み取りは反映済みの資産を参照する。
  bridge.workspace.put(request.path, blob);
  return { status: 'saved', document: await loadMarkdown(request.path) };
}
function downloadFile(blob: Blob, filename: string): string {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename.replace(/[\\/]/g, '_'); document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return filename;
}
export async function copyTextFile(request: { filename: string; content: string; utf8Bom?: boolean }): Promise<string> {
  return downloadFile(new Blob([encode(request.content, 'UTF-8', request.utf8Bom)], { type: 'text/plain;charset=utf-8' }), request.filename);
}
export async function copyMermaidFile(request: { kind: 'code' | 'png' | 'bmp' | 'svg'; diagramKind: 'mermaid' | 'drawio'; source: string; svg: string; pngBytes: number[] }): Promise<string> {
  const extension = request.kind === 'code' ? (request.diagramKind === 'drawio' ? 'drawio' : 'mmd') : request.kind;
  const content = request.kind === 'code' ? request.source : request.kind === 'svg' ? request.svg : new Uint8Array(request.pngBytes);
  return downloadFile(new Blob([content], { type: request.kind === 'code' ? 'text/plain;charset=utf-8' : `image/${request.kind === 'svg' ? 'svg+xml' : request.kind}` }), `diagram.${extension}`);
}
export async function openExternalUrl(url: string): Promise<void> {
  const target = new URL(url, location.href);
  if (!['https:', 'http:', 'mailto:'].includes(target.protocol)) throw new Error('このリンクをWeb版から開くことはできません。');
  window.open(target.href, '_blank', 'noopener,noreferrer');
}
export async function openContainingFolder(): Promise<void> { throw new Error('Web版ではフォルダーを開けません。ZIPを保存して利用してください。'); }
export async function copyBmpToClipboard(): Promise<void> { throw new Error('このブラウザーはBMPコピーに対応していません。'); }
export async function runPowerShell(): Promise<never> { throw new Error('Web版ではPowerShellを実行できません。'); }
export async function saveRenderedImage(): Promise<never> { throw new Error('Web版では画像を外部ファイルへ直接保存できません。'); }
