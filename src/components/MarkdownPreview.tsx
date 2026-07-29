import React from "react";
import ReactMarkdown from "react-markdown";
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
import { resolveLocalMarkdownPath } from "../lib/path";
import type { ImageSize } from "../hooks/useInlineImageResize";
import type { MediaPreviewTarget } from "./MediaPreviewModal";

type MarkdownNode = {
  type?: string;
  lang?: string | null;
  children?: MarkdownNode[];
};

const markdownParser = unified().use(remarkParse).use(remarkGfm);

/** Counts the Mermaid code nodes produced by the same remark parser as ReactMarkdown. */
export function countMermaidFences(markdown: string): number {
  let count = 0;

  const visit = (node: MarkdownNode) => {
    if (node.type === "code" && node.lang?.toLowerCase() === "mermaid") count += 1;
    node.children?.forEach(visit);
  };

  visit(markdownParser.parse(markdown) as MarkdownNode);

  return count;
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
  presentationMode?: boolean;
  onMediaOpen?: (target: MediaPreviewTarget) => void;
}

const MarkdownPreviewComponent: React.FC<MarkdownPreviewProps> = ({
  content,
  baseDir,
  imageVersions,
  contentRef,
  theme = "dark",
  onError,
  foldState = {},
  onFoldChange,
  mermaidMode = "on",
  windowId,
  tabId,
  imageDisplaySizes = {},
  onImageDisplaySizeChange,
  searchExpandedIds = [],
  onSearchFoldManualOverride,
  onOpenDocument,
  presentationMode = false,
  onMediaOpen,
}) => {
  const mermaidCount = countMermaidFences(content);
  let mermaidIndex = 0;

  return (
    <div className="markdown-body" ref={contentRef}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeFoldSections, rehypeBlockAnchors, [rehypeSanitize, markdownSanitizeSchema]]}
        components={{
          section: ({ node, children }) => {
            const foldId = String(node?.properties?.["data-fold-id"] ?? "");
            if (presentationMode) return <section className="presentation-markdown-section">{children}</section>;
            return <FoldSection foldId={foldId} collapsed={foldState[foldId]} onCollapsedChange={onFoldChange} forceExpanded={searchExpandedIds.includes(foldId)} onManualOverride={onSearchFoldManualOverride}>{children}</FoldSection>;
          },
          code: ({ node, className, children, ...props }) => {
            if (className?.toLowerCase().includes("language-mermaid")) {
              const diagramIndex = mermaidIndex++;
              return <MermaidBlock
                source={String(children ?? "")}
                theme={theme}
                mode={mermaidMode}
                windowId={windowId}
                tabId={tabId}
                blockId={`offset-${node?.position?.start.offset ?? diagramIndex}`}
                diagramIndex={diagramIndex}
                diagramCount={mermaidCount}
                onMediaOpen={onMediaOpen}
              />;
            }
            return className?.includes("language-")
              ? <CodeBlock className={className}>{children}</CodeBlock>
              : <code className={className} {...props}>{children}</code>;
          },
          table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
          a: ({ href, children, ...props }) => <a {...props} href={href} onClick={(event) => {
            event.preventDefault();
            if (!href) return;
            const localPath = resolveLocalMarkdownPath(href, baseDir);
            if (localPath) {
              onOpenDocument?.(localPath);
              return;
            }
            if (href.startsWith("#")) {
              const target = document.getElementById(decodeURIComponent(href.slice(1)));
              target?.scrollIntoView({ block: "start" });
              return;
            }
            void openExternalUrl(href).catch((error) => onError?.(String(error)));
          }}>{children}</a>,
          img: ({ src, alt }) => (
            <ImageRenderer
              src={src}
              alt={alt}
              baseDir={baseDir}
              imageVersions={imageVersions}
              displaySize={src ? imageDisplaySizes[src] : undefined}
              onDisplaySizeChange={src ? (size) => onImageDisplaySizeChange?.(src, size) : undefined}
              presentationMode={presentationMode}
              onMediaOpen={onMediaOpen}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export const MarkdownPreview = React.memo(MarkdownPreviewComponent);
