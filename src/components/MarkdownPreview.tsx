import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypeRaw from "rehype-raw";
import { ImageRenderer } from "./ImageRenderer";
import { FoldSection } from "./FoldSection";
import { rehypeFoldSections } from "../lib/foldSections";
import { rehypeBlockAnchors } from "../lib/blockAnchors";
import { markdownSanitizeSchema } from "../lib/sanitizeSchema";
import { CodeBlock } from "./CodeBlock";
import { MermaidBlock } from "./MermaidBlock";
import { openExternalUrl } from "../lib/commands";
import { resolveLocalDocumentPath, resolveSharePointDocumentPath } from "../lib/path";
import type { ImageSize } from "../hooks/useInlineImageResize";
import type { MediaPreviewTarget } from "./MediaPreviewModal";
import { imageOccurrenceId } from "../lib/imageOccurrences";
import { remarkObsidianImages } from "../lib/remarkObsidianImages";

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
}

const MarkdownRenderContext = React.createContext<MarkdownRenderContextValue | null>(null);
const EMPTY_FOLD_STATE: Record<string, boolean> = {};
const EMPTY_IMAGE_DISPLAY_SIZES: Record<string, ImageSize> = {};
const EMPTY_SEARCH_EXPANDED_IDS: string[] = [];

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
  if (className?.toLowerCase().includes("language-mermaid")) {
    const sourceOffset = node?.position?.start.offset;
    const diagramIndex = sourceOffset === undefined ? 0 : context.mermaidIndexByOffset.get(sourceOffset) ?? 0;
    return <MermaidBlock
      source={String(children ?? "")}
      theme={context.theme}
      mode={context.mermaidMode}
      windowId={context.windowId}
      tabId={context.tabId}
      blockId={`offset-${sourceOffset ?? diagramIndex}`}
      diagramIndex={diagramIndex}
      diagramCount={context.mermaidFenceOffsets.length}
      onMediaOpen={context.onMediaOpen}
    />;
  }
  return className?.includes("language-")
    ? <CodeBlock className={className} documentPath={context.presentationMode ? undefined : context.documentPath} onHighlightComplete={context.onCodeHighlightComplete}>{children}</CodeBlock>
    : <code className={className} {...props}>{children}</code>;
};

const MarkdownTable: NonNullable<Components["table"]> = ({ children }) => <div className="table-scroll"><table>{children}</table></div>;

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
    void openExternalUrl(href).catch((error) => context.onError?.(String(error)));
  }}>{children}</a>;
};

const MarkdownImage: NonNullable<Components["img"]> = ({ node, src, alt }) => {
  const context = useMarkdownRenderContext();
  const isObsidianImage = node?.properties?.["data-obsidian-image"] === "true";
  return <ImageRenderer
    src={src}
    alt={alt}
    baseDir={context.baseDir}
    imageVersions={context.imageVersions}
    displaySize={src ? context.imageDisplaySizes[src] : undefined}
    onDisplaySizeChange={src ? (size) => context.onImageDisplaySizeChange?.(src, size) : undefined}
    presentationMode={context.presentationMode}
    onMediaOpen={context.onMediaOpen}
    occurrenceId={imageOccurrenceId(node?.position?.start.offset ?? 0)}
    sourceLine={node?.position?.start.line}
    markdownPath={context.documentPath}
    sourceOffset={isObsidianImage ? undefined : node?.position?.start.offset}
  />;
};

const markdownComponents: Components = {
  section: MarkdownSection,
  code: MarkdownCode,
  table: MarkdownTable,
  a: MarkdownLink,
  img: MarkdownImage,
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
}) => {
  const mermaidFenceOffsets = React.useMemo(() => collectMermaidFenceOffsets(content), [content]);
  const mermaidIndexByOffset = React.useMemo(
    () => new Map(mermaidFenceOffsets.map((offset, index) => [offset, index])),
    [mermaidFenceOffsets],
  );
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
  }), [
    baseDir, documentPath, foldState, imageDisplaySizes, imageVersions, mermaidFenceOffsets,
    mermaidIndexByOffset, mermaidMode, onCodeHighlightComplete, onError, onFoldChange,
    onImageDisplaySizeChange, onMediaOpen, onOpenDocument, onOpenDocumentWindow,
    onSearchFoldManualOverride, presentationMode, searchExpandedIds, sourcePath, tabId, theme, windowId,
  ]);

  return (
    <MarkdownRenderContext.Provider value={renderContext}>
      <div className="markdown-body" ref={contentRef}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkObsidianImages]}
          rehypePlugins={[rehypeRaw, rehypeFoldSections, rehypeBlockAnchors, [rehypeSanitize, markdownSanitizeSchema]]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
    </MarkdownRenderContext.Provider>
  );
};

export const MarkdownPreview = React.memo(MarkdownPreviewComponent);
