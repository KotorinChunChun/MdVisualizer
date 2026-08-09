import type React from "react";
import type { MarkdownLoadResult } from "../types/app";
import type { MediaPreviewTarget } from "./MediaPreviewModal";
import { ImageRenderer } from "./ImageRenderer";
import { MermaidBlock } from "./MermaidBlock";
import { getFileName } from "../lib/path";

interface StandaloneDocumentPreviewProps {
  document: MarkdownLoadResult;
  imageVersions: Record<string, number>;
  contentRef?: React.Ref<HTMLDivElement>;
  theme: string;
  windowId: string;
  tabId: string;
  onMediaOpen?: (target: MediaPreviewTarget) => void;
}

/** Displays direct SVG and Mermaid files through the same safe preview paths used by Markdown embeds. */
export function StandaloneDocumentPreview({
  document,
  imageVersions,
  contentRef,
  theme,
  windowId,
  tabId,
  onMediaOpen,
}: StandaloneDocumentPreviewProps) {
  if (document.kind === "svg") {
    return <div className="markdown-body standalone-document standalone-document--svg" ref={contentRef}>
      <ImageRenderer
        src={document.path}
        alt={getFileName(document.path)}
        baseDir={document.base_dir}
        imageVersions={imageVersions}
        onMediaOpen={onMediaOpen}
      />
    </div>;
  }

  if (document.kind === "mermaid") {
    return <div className="markdown-body standalone-document standalone-document--mermaid" ref={contentRef}>
      <MermaidBlock
        source={document.content}
        theme={theme}
        mode="on"
        windowId={windowId}
        tabId={tabId}
        blockId="standalone-document"
        diagramIndex={0}
        diagramCount={1}
        onMediaOpen={onMediaOpen}
      />
    </div>;
  }

  return null;
}
