import React from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypeRaw from "rehype-raw";
import { ImageRenderer } from "./ImageRenderer";
import { FoldSection, useIsFoldHeading } from "./FoldSection";
import { rehypeFoldSections } from "../lib/foldSections";
import { rehypeBlockAnchors } from "../lib/blockAnchors";
import { markdownSanitizeSchema } from "../lib/sanitizeSchema";
import { CodeBlock } from "./CodeBlock";
import { MermaidBlock } from "./MermaidBlock";
import { openExternalUrl } from "../lib/commands";
import { resolveSharePointBrowserUrl } from "../lib/sharePoint";
import { resolveLocalDocumentPath, resolveLocalImagePath, resolveSharePointDocumentPath } from "../lib/path";
import type { ImageSize } from "../hooks/useInlineImageResize";
import type { MediaPreviewTarget } from "./MediaPreviewModal";
import { imageOccurrenceId } from "../lib/imageOccurrences";
import { remarkObsidianImages } from "../lib/remarkObsidianImages";
import { DelimitedTableBlock } from "./DelimitedTableBlock";
import { TableEditorDialog } from "./TableEditorDialog";
import { isDelimitedTableLanguage } from "../lib/delimitedTable";
import { collectEditableMarkdownOccurrences, serializeMarkdownTable, type CodeFenceOccurrence, type ImageMarkdownOccurrence, type InlineSvgOccurrence, type MarkdownTableOccurrence } from "../lib/markdownOccurrences";
import { parseRasterDataUri, type AssetConversionContext } from "../lib/assetConversion";
import { sanitizeSvgXml } from "../lib/svgSafety";
import { DrawioBlock } from "./DrawioBlock";
import { ExternalDrawioBlock } from "./ExternalDrawioBlock";
import { ExternalMermaidBlock } from "./ExternalMermaidBlock";
import { PlantUmlBlock } from "./PlantUmlBlock";
import { isPlantUmlFenceLanguage } from "@markdown-viewer/markdown-core";
import { normalizeStructuredListIndentationForRendering } from "../lib/markdownEditing";
import type { DrawioStorageConversionContext } from "../lib/drawioStorage";
import type { MermaidStorageConversionContext } from "../lib/mermaidStorage";
import { ShortcutKeySvg } from "./ShortcutKeySvg";
import { isShortcutKeySource } from "@markdown-viewer/markdown-core";

type MarkdownNode = {
  type?: string;
  lang?: string | null;
  position?: { start?: { offset?: number } };
  children?: MarkdownNode[];
};

const markdownParser = unified().use(remarkParse).use(remarkGfm);

function collectMermaidFenceOffsets(markdown: string): number[] {
  const offsets: number[] = [];

  const visit = (node: MarkdownNode) => {
    if (node.type === "code" && node.lang?.toLowerCase() === "mermaid") {
      offsets.push(node.position?.start?.offset ?? offsets.length);
    }
    node.children?.forEach(visit);
  };

  visit(markdownParser.parse(markdown) as MarkdownNode);
  return offsets;
}

/** Counts the Mermaid code nodes produced by the same remark parser as ReactMarkdown. */
export function countMermaidFences(markdown: string): number {
  return collectMermaidFenceOffsets(markdown).length;
}

interface MarkdownPreviewProps {
  content: string;
  baseDir: string;
  imageVersions: Record<string, number>;
  contentRef?: React.Ref<HTMLDivElement>;
  theme?: string;
  onError?: (message: string) => void;
  foldState?: Record<string, boolean>;
  onFoldChange?: (foldId: string, collapsed: boolean) => void;
  mermaidMode?: "on" | "off" | "error-code" | "always-code";
  windowId?: string;
  tabId?: string;
  imageDisplaySizes?: Record<string, ImageSize>;
  onImageDisplaySizeChange?: (source: string, size: ImageSize) => void;
  searchExpandedIds?: string[];
  onSearchFoldManualOverride?: (foldId: string) => void;
  onOpenDocument?: (path: string) => void;
  onOpenDocumentWindow?: (path: string) => void;
  presentationMode?: boolean;
  onMediaOpen?: (target: MediaPreviewTarget) => void;
  documentPath?: string;
  sourcePath?: string;
  onCodeHighlightComplete?: () => void;
  onCodeFenceBodyChange?: (occurrence: CodeFenceOccurrence, body: string) => boolean | void;
  onMarkdownTableChange?: (occurrence: MarkdownTableOccurrence, replacement: string) => boolean | void;
  stagedAssetPreviews?: Record<string, string>;
  stagedDrawioSources?: Record<string, string>;
  stagedMermaidSources?: Record<string, string>;
  onDrawioStorageConvert?: (context: DrawioStorageConversionContext) => boolean | void | Promise<boolean | void>;
  onMermaidStorageConvert?: (context: MermaidStorageConversionContext) => boolean | void | Promise<boolean | void>;
  onStagedTextAssetChange?: (filename: string, text: string) => boolean | void;
  diffChangedLines?: ReadonlySet<number>;
  staticMode?: boolean;
}

type DiffHastNode = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  position?: { start?: { line?: number }; end?: { line?: number } };
  children?: DiffHastNode[];
};

const DIFF_BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "table", "hr"]);

function rehypeDiffLines(options?: { changedLines?: number[] }) {
  const changedLines = new Set(options?.changedLines ?? []);
  return (tree: DiffHastNode) => {
    if (changedLines.size === 0) return;
    const visit = (node: DiffHastNode) => {
      const start = node.position?.start?.line;
      const end = node.position?.end?.line ?? start;
      if (node.type === "element" && node.tagName && DIFF_BLOCK_TAGS.has(node.tagName) && start && end) {
        let changed = false;
        for (let line = start; line <= end; line += 1) {
          if (changedLines.has(line)) { changed = true; break; }
        }
        if (changed) {
          node.properties ??= {};
          const current = node.properties.className;
          const classes = Array.isArray(current) ? current : typeof current === "string" ? current.split(/\s+/) : [];
          node.properties.className = [...classes, "markdown-diff-line"];
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

interface MarkdownRenderContextValue {
  baseDir: string;
  imageVersions: Record<string, number>;
  theme: string;
  onError?: (message: string) => void;
  foldState: Record<string, boolean>;
  onFoldChange?: (foldId: string, collapsed: boolean) => void;
  mermaidMode: "on" | "off" | "error-code" | "always-code";
  windowId?: string;
  tabId?: string;
  imageDisplaySizes: Record<string, ImageSize>;
  onImageDisplaySizeChange?: (source: string, size: ImageSize) => void;
  searchExpandedIds: string[];
  onSearchFoldManualOverride?: (foldId: string) => void;
  onOpenDocument?: (path: string) => void;
  onOpenDocumentWindow?: (path: string) => void;
  presentationMode: boolean;
  onMediaOpen?: (target: MediaPreviewTarget) => void;
  documentPath?: string;
  sourcePath?: string;
  onCodeHighlightComplete?: () => void;
  mermaidFenceOffsets: number[];
  mermaidIndexByOffset: Map<number, number>;
  codeFenceByOffset: Map<number, CodeFenceOccurrence>;
  onCodeFenceBodyChange?: (occurrence: CodeFenceOccurrence, body: string) => boolean | void;
  tableByOffset: Map<number, MarkdownTableOccurrence>;
  onMarkdownTableChange?: (occurrence: MarkdownTableOccurrence, replacement: string) => boolean | void;
  imageOccurrenceByOffset: Map<number, ImageMarkdownOccurrence>;
  inlineSvgByOffset: Map<number, InlineSvgOccurrence>;
  stagedAssetPreviews: Record<string, string>;
  stagedDrawioSources: Record<string, string>;
  stagedMermaidSources: Record<string, string>;
  onDrawioStorageConvert?: (context: DrawioStorageConversionContext) => boolean | void | Promise<boolean | void>;
  onMermaidStorageConvert?: (context: MermaidStorageConversionContext) => boolean | void | Promise<boolean | void>;
  onStagedTextAssetChange?: (filename: string, text: string) => boolean | void;
  staticMode: boolean;
}

const MarkdownRenderContext = React.createContext<MarkdownRenderContextValue | null>(null);
const EMPTY_FOLD_STATE: Record<string, boolean> = {};
const EMPTY_IMAGE_DISPLAY_SIZES: Record<string, ImageSize> = {};
const EMPTY_SEARCH_EXPANDED_IDS: string[] = [];

function markdownUrlTransform(url: string, key: string): string {
  if (key === "src" && /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i.test(url)) return url;
  return defaultUrlTransform(url);
}

function useMarkdownRenderContext(): MarkdownRenderContextValue {
  const context = React.useContext(MarkdownRenderContext);
  if (!context) throw new Error("Markdown renderer must be used inside MarkdownPreview.");
  return context;
}

const MarkdownSection: NonNullable<Components["section"]> = ({ node, children }) => {
  const context = useMarkdownRenderContext();
  const foldId = String(node?.properties?.["data-fold-id"] ?? "");
  if (context.presentationMode) return <section className="presentation-markdown-section">{children}</section>;
  return <FoldSection foldId={foldId} collapsed={context.foldState[foldId]} onCollapsedChange={context.onFoldChange} forceExpanded={context.searchExpandedIds.includes(foldId)} onManualOverride={context.onSearchFoldManualOverride}>{children}</FoldSection>;
};

const MarkdownCode: NonNullable<Components["code"]> = ({ node, className, children, ...props }) => {
  const context = useMarkdownRenderContext();
  const language = className?.match(/language-([\w-]+)/)?.[1]?.toLowerCase();
  if (context.staticMode && language) {
    return <code className={className} {...props}>{children}</code>;
  }
  const source = String(children ?? "");
  if (!language && isShortcutKeySource(source)) {
    return <ShortcutKeySvg source={source} variant="inline" />;
  }
  if (language === "drawio") {
    const sourceOffset = node?.position?.start.offset;
    const occurrence = sourceOffset === undefined ? undefined : context.codeFenceByOffset.get(sourceOffset);
    return <DrawioBlock
      source={String(children ?? "").replace(/\n$/, "")}
      theme={context.theme}
      blockId={occurrence?.id ?? `offset-${sourceOffset ?? 0}`}
      storage={occurrence ? "embedded" : undefined}
      onStorageConvert={occurrence && context.documentPath && context.onDrawioStorageConvert
        ? () => context.onDrawioStorageConvert?.({ documentPath: context.documentPath!, storage: "embedded", occurrence, source: String(children ?? "").replace(/\n$/, "") })
        : undefined}
      onSave={occurrence && context.onCodeFenceBodyChange ? (body) => context.onCodeFenceBodyChange?.(occurrence, body) : undefined}
      onMediaOpen={context.onMediaOpen}
    />;
  }
  if (isDelimitedTableLanguage(language)) {
    const sourceOffset = node?.position?.start.offset;
    const occurrence = sourceOffset === undefined ? undefined : context.codeFenceByOffset.get(sourceOffset);
    return <DelimitedTableBlock
      language={language}
      source={String(children ?? "").replace(/\n$/, "")}
      onSave={occurrence && context.onCodeFenceBodyChange ? (body) => context.onCodeFenceBodyChange?.(occurrence, body) : undefined}
    />;
  }
  if (isPlantUmlFenceLanguage(language)) {
    const sourceOffset = node?.position?.start.offset;
    return <PlantUmlBlock
      source={String(children ?? "").replace(/\n$/, "")}
      theme={context.theme}
      mode={context.mermaidMode}
      windowId={context.windowId}
      tabId={context.tabId}
      blockId={`plantuml-offset-${sourceOffset ?? 0}`}
      onMediaOpen={context.onMediaOpen}
    />;
  }
  if (className?.toLowerCase().includes("language-mermaid")) {
    const sourceOffset = node?.position?.start.offset;
    const diagramIndex = sourceOffset === undefined ? 0 : context.mermaidIndexByOffset.get(sourceOffset) ?? 0;
    const occurrence = sourceOffset === undefined ? undefined : context.codeFenceByOffset.get(sourceOffset);
    const mermaidSource = String(children ?? "").replace(/\n$/, "");
    return <MermaidBlock
      source={mermaidSource}
      theme={context.theme}
      mode={context.mermaidMode}
      windowId={context.windowId}
      tabId={context.tabId}
      blockId={`offset-${sourceOffset ?? diagramIndex}`}
      diagramIndex={diagramIndex}
      diagramCount={context.mermaidFenceOffsets.length}
      onMediaOpen={context.onMediaOpen}
      editable={!context.staticMode && !context.presentationMode && Boolean(context.documentPath)}
      storage={occurrence ? "embedded" : undefined}
      onStorageConvert={occurrence && context.documentPath && context.onMermaidStorageConvert
        ? () => context.onMermaidStorageConvert?.({ documentPath: context.documentPath!, storage: "embedded", occurrence, source: mermaidSource })
        : undefined}
    />;
  }
  return className?.includes("language-")
    ? <CodeBlock className={className} documentPath={context.presentationMode ? undefined : context.documentPath} onHighlightComplete={context.onCodeHighlightComplete}>{children}</CodeBlock>
    : <code className={className} {...props}>{children}</code>;
};

const MarkdownTable: NonNullable<Components["table"]> = ({ node, children, ...props }) => {
  const context = useMarkdownRenderContext();
  const [editing, setEditing] = React.useState(false);
  const offset = node?.position?.start.offset;
  const occurrence = offset === undefined ? undefined : context.tableByOffset.get(offset);
  const editable = Boolean(occurrence && context.documentPath && context.onMarkdownTableChange && !context.staticMode && !context.presentationMode);
  return <div className="table-scroll markdown-table-card">
    {editable && <button type="button" className="markdown-table-edit" aria-label="表を編集" title="表を編集" onClick={() => setEditing(true)}>✎</button>}
    <table {...props}>{children}</table>
    {editing && occurrence && <TableEditorDialog
      initialHeaders={occurrence.headers}
      initialRows={occurrence.rows}
      initialAlignments={occurrence.alignments}
      showAlignments
      onCancel={() => setEditing(false)}
      onSave={(table) => context.onMarkdownTableChange?.(occurrence, serializeMarkdownTable({ ...table, lineEnding: occurrence.lineEnding, continuationPrefix: occurrence.continuationPrefix }))}
    />}
  </div>;
};

const MarkdownLink: NonNullable<Components["a"]> = ({ href, children, ...props }) => {
  const context = useMarkdownRenderContext();
  return <a {...props} href={href} onClick={(event) => {
    event.preventDefault();
    if (!href) return;
    const documentTarget = resolveSharePointDocumentPath(href, context.sourcePath ?? context.documentPath) ?? resolveLocalDocumentPath(href, context.baseDir);
    if (documentTarget) {
      if (event.ctrlKey) context.onOpenDocumentWindow?.(documentTarget);
      else context.onOpenDocument?.(documentTarget);
      return;
    }
    if (href.startsWith("#")) {
      const target = document.getElementById(decodeURIComponent(href.slice(1)));
      target?.scrollIntoView({ block: "start" });
      return;
    }
    const browserTarget = resolveSharePointBrowserUrl(href, context.sourcePath ?? context.documentPath) ?? href;
    void openExternalUrl(browserTarget).catch((error) => context.onError?.(String(error)));
  }}>{children}</a>;
};

const MarkdownImage: NonNullable<Components["img"]> = ({ node, src, alt }) => {
  const context = useMarkdownRenderContext();
  const headingMode = useIsFoldHeading();
  const isObsidianImage = node?.properties?.["data-obsidian-image"] === "true";
  const sourceOffset = node?.position?.start.offset;
  const occurrence = sourceOffset === undefined ? undefined : context.imageOccurrenceByOffset.get(sourceOffset);
  const source = String(src ?? "");
  const local = source && !/^(?:https?:|file:|\/\/)/i.test(source);
  const drawioPath = local && /\.drawio(?:[?#]|$)/i.test(source)
    ? resolveLocalImagePath(source, context.baseDir)
    : null;
  if (drawioPath) {
    return <ExternalDrawioBlock
      source={source}
      alt={alt}
      baseDir={context.baseDir}
      theme={context.theme}
      blockId={imageOccurrenceId(sourceOffset ?? 0)}
      version={context.imageVersions[drawioPath] ?? 0}
      editable={!context.staticMode && !context.presentationMode}
      stagedSource={context.stagedDrawioSources[source]}
      onStagedSourceChange={context.stagedDrawioSources[source] !== undefined && context.onStagedTextAssetChange
        ? (text) => context.onStagedTextAssetChange?.(source, text)
        : undefined}
      onStorageConvert={occurrence && context.documentPath && context.onDrawioStorageConvert
        ? (drawioSource) => context.onDrawioStorageConvert?.({ documentPath: context.documentPath!, storage: "external", occurrence, source: drawioSource })
        : undefined}
      onMediaOpen={context.onMediaOpen}
    />;
  }
  const mermaidPath = local && /\.(?:mmd|mermaid)(?:[?#]|$)/i.test(source)
    ? resolveLocalImagePath(source, context.baseDir)
    : null;
  if (mermaidPath) {
    return <ExternalMermaidBlock
      source={source}
      alt={alt}
      baseDir={context.baseDir}
      theme={context.theme}
      blockId={imageOccurrenceId(sourceOffset ?? 0)}
      version={context.imageVersions[mermaidPath] ?? 0}
      editable={!context.staticMode && !context.presentationMode}
      stagedSource={context.stagedMermaidSources[source]}
      onStorageConvert={occurrence && context.documentPath && context.onMermaidStorageConvert
        ? (mermaidSource) => context.onMermaidStorageConvert?.({ documentPath: context.documentPath!, storage: "external", occurrence, source: mermaidSource })
        : undefined}
      onMediaOpen={context.onMediaOpen}
    />;
  }
  const assetKind = parseRasterDataUri(source) || /\.(?:png|jpe?g|gif|webp|bmp)(?:[?#]|$)/i.test(source) ? "raster" : /\.svg(?:[?#]|$)/i.test(source) ? "svg" : null;
  const conversionContext: AssetConversionContext | undefined = occurrence && context.documentPath && local && assetKind ? {
    documentPath: context.documentPath,
    occurrence,
    assetKind,
    storage: source.toLowerCase().startsWith("data:") ? "embedded" : "external",
  } : undefined;
  return <ImageRenderer
    src={src}
    alt={alt}
    baseDir={context.baseDir}
    imageVersions={context.imageVersions}
    displaySize={src ? context.imageDisplaySizes[src] : undefined}
    onDisplaySizeChange={src ? (size) => context.onImageDisplaySizeChange?.(src, size) : undefined}
    presentationMode={context.presentationMode}
    headingMode={headingMode}
    onMediaOpen={context.onMediaOpen}
    occurrenceId={imageOccurrenceId(node?.position?.start.offset ?? 0)}
    sourceLine={node?.position?.start.line}
    markdownPath={context.documentPath}
    documentSourcePath={context.sourcePath}
    sourceOffset={isObsidianImage ? undefined : sourceOffset}
    conversionContext={conversionContext}
    previewSrc={context.stagedAssetPreviews[source]}
  />;
};

const MarkdownSvg = ({ node }: { node?: { position?: { start?: { offset?: number } } } }) => {
  const context = useMarkdownRenderContext();
  const offset = node?.position?.start?.offset;
  const svgOccurrences = [...context.inlineSvgByOffset.values()];
  const occurrence = (offset === undefined ? undefined : context.inlineSvgByOffset.get(offset) ?? svgOccurrences.find((candidate) => offset >= candidate.start && offset < candidate.end))
    ?? (svgOccurrences.length === 1 ? svgOccurrences[0] : undefined);
  if (!occurrence) return null;
  let safeSvg: string;
  try { safeSvg = sanitizeSvgXml(occurrence.svg); }
  catch { return <span className="image-error-fallback">⚠️ SVGを表示できません</span>; }
  const conversionContext: AssetConversionContext | undefined = context.documentPath ? { documentPath: context.documentPath, occurrence, assetKind: "svg", storage: "embedded" } : undefined;
  return <span className="inline-svg-preview" role="img" aria-label="インラインSVG" onClick={(event) => {
    event.preventDefault(); event.stopPropagation();
    context.onMediaOpen?.({ content: { kind: "svg", svg: safeSvg, alt: "SVG" }, conversionContext });
  }} dangerouslySetInnerHTML={{ __html: safeSvg }} />;
};

const MarkdownListDepthContext = React.createContext(0);

const MarkdownOrderedList: NonNullable<Components["ol"]> = ({ node: _node, children, ...props }) => {
  const depth = React.useContext(MarkdownListDepthContext);
  return <MarkdownListDepthContext.Provider value={depth + 1}>
    <ol {...props}>{children}</ol>
  </MarkdownListDepthContext.Provider>;
};

const MarkdownUnorderedList: NonNullable<Components["ul"]> = ({ node: _node, children, className, ...props }) => {
  const depth = React.useContext(MarkdownListDepthContext);
  const markerClass = depth % 2 === 0 ? "markdown-list-marker-even" : "markdown-list-marker-odd";
  return <MarkdownListDepthContext.Provider value={depth + 1}>
    <ul {...props} className={[className, markerClass].filter(Boolean).join(" ")}>{children}</ul>
  </MarkdownListDepthContext.Provider>;
};

const markdownComponents: Components = {
  section: MarkdownSection,
  code: MarkdownCode,
  table: MarkdownTable,
  a: MarkdownLink,
  img: MarkdownImage,
  svg: MarkdownSvg as Components["svg"],
  ol: MarkdownOrderedList,
  ul: MarkdownUnorderedList,
};

const MarkdownPreviewComponent: React.FC<MarkdownPreviewProps> = ({
  content,
  baseDir,
  imageVersions,
  contentRef,
  theme = "dark",
  onError,
  foldState = EMPTY_FOLD_STATE,
  onFoldChange,
  mermaidMode = "on",
  windowId,
  tabId,
  imageDisplaySizes = EMPTY_IMAGE_DISPLAY_SIZES,
  onImageDisplaySizeChange,
  searchExpandedIds = EMPTY_SEARCH_EXPANDED_IDS,
  onSearchFoldManualOverride,
  onOpenDocument,
  onOpenDocumentWindow,
  presentationMode = false,
  onMediaOpen,
  documentPath,
  sourcePath,
  onCodeHighlightComplete,
  onCodeFenceBodyChange,
  onMarkdownTableChange,
  stagedAssetPreviews = {},
  stagedDrawioSources = {},
  stagedMermaidSources = {},
  onDrawioStorageConvert,
  onMermaidStorageConvert,
  onStagedTextAssetChange,
  diffChangedLines,
  staticMode = false,
}) => {
  const renderedContent = React.useMemo(() => normalizeStructuredListIndentationForRendering(content), [content]);
  const mermaidFenceOffsets = React.useMemo(() => collectMermaidFenceOffsets(content), [content]);
  const mermaidIndexByOffset = React.useMemo(
    () => new Map(mermaidFenceOffsets.map((offset, index) => [offset, index])),
    [mermaidFenceOffsets],
  );
  const editableOccurrences = React.useMemo(() => collectEditableMarkdownOccurrences(content), [content]);
  const codeFenceByOffset = React.useMemo(() => new Map(
    editableOccurrences
      .filter((occurrence): occurrence is CodeFenceOccurrence => occurrence.kind === "code-fence")
      .map((occurrence) => [occurrence.start, occurrence]),
  ), [editableOccurrences]);
  const imageOccurrenceByOffset = React.useMemo(() => new Map(editableOccurrences.filter((occurrence): occurrence is ImageMarkdownOccurrence => occurrence.kind === "image").map((occurrence) => [occurrence.start, occurrence])), [editableOccurrences]);
  const inlineSvgByOffset = React.useMemo(() => new Map(editableOccurrences.filter((occurrence): occurrence is InlineSvgOccurrence => occurrence.kind === "inline-svg").map((occurrence) => [occurrence.start, occurrence])), [editableOccurrences]);
  const tableByOffset = React.useMemo(() => new Map(editableOccurrences.filter((occurrence): occurrence is MarkdownTableOccurrence => occurrence.kind === "table").map((occurrence) => [occurrence.start, occurrence])), [editableOccurrences]);
  const renderContext = React.useMemo<MarkdownRenderContextValue>(() => ({
    baseDir,
    imageVersions,
    theme,
    onError,
    foldState,
    onFoldChange,
    mermaidMode,
    windowId,
    tabId,
    imageDisplaySizes,
    onImageDisplaySizeChange,
    searchExpandedIds,
    onSearchFoldManualOverride,
    onOpenDocument,
    onOpenDocumentWindow,
    presentationMode,
    onMediaOpen,
    documentPath,
    sourcePath,
    onCodeHighlightComplete,
    mermaidFenceOffsets,
    mermaidIndexByOffset,
    codeFenceByOffset,
    onCodeFenceBodyChange,
    tableByOffset,
    onMarkdownTableChange,
    imageOccurrenceByOffset,
    inlineSvgByOffset,
    stagedAssetPreviews,
    stagedDrawioSources,
    stagedMermaidSources,
    onDrawioStorageConvert,
    onMermaidStorageConvert,
    onStagedTextAssetChange,
    staticMode,
  }), [
    baseDir, codeFenceByOffset, documentPath, foldState, imageDisplaySizes, imageOccurrenceByOffset, imageVersions, inlineSvgByOffset, mermaidFenceOffsets,
    mermaidIndexByOffset, mermaidMode, onCodeHighlightComplete, onError, onFoldChange,
    onCodeFenceBodyChange, onMarkdownTableChange, onDrawioStorageConvert, onMermaidStorageConvert, onImageDisplaySizeChange, onMediaOpen, onOpenDocument, onOpenDocumentWindow,
    onSearchFoldManualOverride, onStagedTextAssetChange, presentationMode, searchExpandedIds, sourcePath, stagedAssetPreviews, stagedDrawioSources, stagedMermaidSources, staticMode, tabId, tableByOffset, theme, windowId,
  ]);

  return (
    <MarkdownRenderContext.Provider value={renderContext}>
      <div className="markdown-body" ref={contentRef}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkObsidianImages]}
          rehypePlugins={[
            rehypeRaw,
            rehypeFoldSections,
            rehypeBlockAnchors,
            [rehypeSanitize, markdownSanitizeSchema],
            [rehypeDiffLines, { changedLines: [...(diffChangedLines ?? [])] }],
          ]}
          components={markdownComponents}
          urlTransform={markdownUrlTransform}
        >
          {renderedContent}
        </ReactMarkdown>
      </div>
    </MarkdownRenderContext.Provider>
  );
};

export const MarkdownPreview = React.memo(MarkdownPreviewComponent);
