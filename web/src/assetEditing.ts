import { normalizedAssetFilename, parseRasterDataUri, replaceImageOccurrenceSource } from '../../src/lib/assetConversion';
import { drawioEmbeddedFence, drawioExternalReference, markdownLineEnding, preferredDrawioFilename, type DrawioStorageConversionContext } from '../../src/lib/drawioStorage';
import { collectEditableMarkdownOccurrences, replaceMarkdownOccurrence, type ImageMarkdownOccurrence, type InlineSvgOccurrence } from '../../src/lib/markdownOccurrences';
import { mermaidEmbeddedFence, mermaidExternalReference, preferredMermaidFilename, type MermaidStorageConversionContext } from '../../src/lib/mermaidStorage';
import type { TableStorageConversionContext } from '../../src/lib/tableStorage';
import { sourceExtensionForLanguage, textExternalReference, type TextStorageConversionContext } from '../../src/lib/textStorage';
import type { DocumentSession } from './documentSession';
import { assetBase, assetMime, resolveAssetPath, safePath } from './workspace';

type StorageContext = DrawioStorageConversionContext | MermaidStorageConversionContext | TableStorageConversionContext | TextStorageConversionContext;
type DiagramKind = 'drawio' | 'mermaid' | 'table' | 'text';

function assertDocument(session: DocumentSession, documentPath: string): void {
  if (safePath(documentPath) !== session.name) throw new Error('別の文書に対する資産操作は実行できません。');
}
function relativeFromDocument(session: DocumentSession, target: string): string {
  const base = assetBase(session.name).replace(/\/$/, '').split('/').filter(Boolean);
  const parts = target.split('/'); let common = 0;
  while (common < base.length && base[common] === parts[common]) common += 1;
  return [...Array.from({ length: base.length - common }, () => '..'), ...parts.slice(common)].join('/') || parts.at(-1)!;
}
function extensionFor(context: StorageContext): string {
  if ('language' in context) return context.language === 'csv' || context.language === 'tsv'
    ? context.language
    : sourceExtensionForLanguage(context.language);
  if (context.occurrence.kind === 'code-fence') return context.occurrence.language === 'mermaid' ? 'mmd' : 'drawio';
  return 'txt';
}
function contextKind(context: StorageContext): DiagramKind {
  if (context.occurrence.kind === 'code-fence') {
    if (context.occurrence.language === 'mermaid') return 'mermaid';
    if (context.occurrence.language === 'drawio') return 'drawio';
    return context.occurrence.language === 'csv' || context.occurrence.language === 'tsv' ? 'table' : 'text';
  }
  if ('language' in context) return context.language === 'csv' || context.language === 'tsv' ? 'table' : 'text';
  const extension = context.occurrence.source.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  if (extension === 'mmd' || extension === 'mermaid') return 'mermaid';
  if (extension === 'drawio') return 'drawio';
  return 'text';
}
function asTextBlob(path: string, text: string): Blob { return new Blob([text], { type: `${assetMime(path)};charset=utf-8` }); }
function addAsset(session: DocumentSession, path: string, blob: Blob): DocumentSession {
  const key = safePath(path);
  if (key === session.name || session.assets.some(asset => asset.path === key)) throw new Error(`資産名が重複しています: ${key}`);
  return { ...session, assets: [...session.assets, { path: key, blob }] };
}
function isLocalAssetSource(source: string): boolean {
  return !/^(?:data:|blob:|https?:|\/\/|#|[a-z][a-z0-9+.-]*:)/i.test(source.trim());
}
function resolvesToAsset(source: string, session: DocumentSession, target: string): boolean {
  if (!isLocalAssetSource(source)) return false;
  try { return resolveAssetPath(source, assetBase(session.name)) === target; } catch { return false; }
}
function fence(language: string, source: string, lineEnding: '\n' | '\r\n' | '\r'): string {
  const normalized = source.replace(/\r\n|\r|\n/g, lineEnding).replace(/(?:\r\n|\r|\n)$/, '');
  const longestBacktickRun = Math.max(0, ...Array.from(normalized.matchAll(/`+/g), match => match[0].length));
  const marker = '`'.repeat(Math.max(3, longestBacktickRun + 1));
  return `${marker}${language}${lineEnding}${normalized}${lineEnding}${marker}`;
}

/** Converts a shared Preview storage context without mutating the active browser session. */
export async function convertSessionStorage(session: DocumentSession, context: StorageContext): Promise<DocumentSession> {
  assertDocument(session, context.documentPath);
  const kind = contextKind(context);
  if (context.storage === 'embedded') {
    if (context.occurrence.kind !== 'code-fence') throw new Error('埋め込み資産の参照が不正です。');
    const preferred = context.relativePath || (kind === 'drawio' ? preferredDrawioFilename(context.occurrence) : kind === 'mermaid' ? preferredMermaidFilename(context.occurrence) : normalizedAssetFilename('asset', extensionFor(context), 'asset'));
    const path = resolveAssetPath(preferred, assetBase(session.name));
    const next = addAsset(session, path, asTextBlob(path, context.source));
    const reference = relativeFromDocument(next, path);
    const replacement = kind === 'drawio' ? drawioExternalReference(reference, 'alt' in context ? context.alt : '') : kind === 'mermaid' ? mermaidExternalReference(reference, 'alt' in context ? context.alt : '') : kind === 'text' ? textExternalReference(reference) : `![${reference}](${reference})`;
    return { ...next, markdown: replaceMarkdownOccurrence(next.markdown, context.occurrence, replacement) };
  }
  if (context.occurrence.kind !== 'image') throw new Error('外部資産の参照が不正です。');
  const occurrence = context.occurrence;
  const path = resolveAssetPath(occurrence.source, assetBase(session.name));
  const asset = session.assets.find(item => item.path === path);
  if (!asset) throw new Error(`資産を見つけられません: ${path}`);
  const source = context.source;
  const lineEnding = markdownLineEnding(session.markdown);
  const replacement = kind === 'drawio' ? drawioEmbeddedFence(source, lineEnding) : kind === 'mermaid' ? mermaidEmbeddedFence(source, lineEnding) : fence('language' in context ? context.language : 'text', source, lineEnding);
  return { ...session, markdown: replaceMarkdownOccurrence(session.markdown, occurrence, replacement) };
}

export function applyInlineSvgEdit(session: DocumentSession, occurrence: InlineSvgOccurrence, svg: string): DocumentSession {
  return { ...session, markdown: replaceMarkdownOccurrence(session.markdown, occurrence, svg) };
}

/** Renames one ZIP asset and every current-document reference, rejecting references in sibling Markdown files. */
export async function renameSessionAsset(session: DocumentSession, source: string, filename: string): Promise<DocumentSession> {
  if (!filename || /[\\/\u0000-\u001f:]/.test(filename) || filename === '.' || filename === '..') throw new Error('資産ファイル名が不正です。');
  const from = resolveAssetPath(source, assetBase(session.name));
  const asset = session.assets.find(item => item.path === from);
  if (!asset) throw new Error(`資産を見つけられません: ${from}`);
  const parent = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
  const to = safePath(`${parent}${filename}`);
  if (to !== from && (to === session.name || session.assets.some(item => item.path === to))) throw new Error(`資産名が重複しています: ${to}`);
  for (const sibling of session.assets) {
    if (!/\.(?:md|markdown)$/i.test(sibling.path)) continue;
    const siblingMarkdown = await sibling.blob.text();
    if (collectEditableMarkdownOccurrences(siblingMarkdown).some(item => item.kind === 'image' && resolvesToAsset(item.source, { ...session, name: sibling.path }, from))) {
      throw new Error(`別のMarkdownがこの資産を参照しています: ${sibling.path}`);
    }
  }
  let markdown = session.markdown;
  const replacement = relativeFromDocument(session, to);
  const matches = collectEditableMarkdownOccurrences(markdown).filter((item): item is ImageMarkdownOccurrence => item.kind === 'image' && resolvesToAsset(item.source, session, from));
  for (const item of matches.sort((left, right) => right.start - left.start)) markdown = replaceImageOccurrenceSource(markdown, item, replacement);
  return { ...session, markdown, assets: session.assets.map(item => item.path === from ? { ...item, path: to } : item) };
}

export async function applyImageEdit(session: DocumentSession, occurrence: ImageMarkdownOccurrence, dataUri: string): Promise<DocumentSession> {
  const raster = parseRasterDataUri(dataUri);
  if (!raster) throw new Error('編集画像は対応するPNG/JPEG/GIF/WebP/BMP形式ではありません。');
  const verifiedMarkdown = replaceImageOccurrenceSource(session.markdown, occurrence, occurrence.source);
  if (/^data:/i.test(occurrence.source)) return { ...session, markdown: replaceImageOccurrenceSource(verifiedMarkdown, occurrence, dataUri) };
  if (!isLocalAssetSource(occurrence.source)) return { ...session, markdown: replaceImageOccurrenceSource(verifiedMarkdown, occurrence, dataUri) };
  const from = resolveAssetPath(occurrence.source, assetBase(session.name));
  const asset = session.assets.find(item => item.path === from);
  if (!asset) throw new Error(`資産を見つけられません: ${from}`);
  const bytes = Uint8Array.from(atob(raster.base64), character => character.charCodeAt(0));
  const blob = new Blob([bytes], { type: raster.mediaType });
  const currentExtension = from.split('.').pop()?.toLowerCase();
  if (currentExtension === raster.extension) return { ...session, markdown: verifiedMarkdown, assets: session.assets.map(item => item.path === from ? { ...item, blob } : item) };
  const parent = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
  const stem = from.slice(parent.length).replace(/\.[^.]+$/, '');
  let index = 0; let target = '';
  do { target = safePath(`${parent}${normalizedAssetFilename(`${stem}${index ? `-edited-${index}` : '-edited'}`, raster.extension, 'image')}`); index += 1; } while (target === session.name || session.assets.some(item => item.path === target));
  const next = addAsset(session, target, blob);
  return { ...next, markdown: replaceImageOccurrenceSource(next.markdown, occurrence, relativeFromDocument(next, target)) };
}
