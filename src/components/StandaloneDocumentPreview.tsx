import type React from "react";
import type { MarkdownLoadResult } from "../types/app";
import type { MediaPreviewTarget } from "./MediaPreviewModal";
import { ImageRenderer } from "./ImageRenderer";
import { MermaidBlock } from "./MermaidBlock";
import { DrawioBlock } from "./DrawioBlock";
import { getFileName } from "../lib/path";
import { DelimitedTableBlock } from "./DelimitedTableBlock";
import { FileSvgCodexAction } from "../features/codex/FileSvgCodexAction";

interface StandaloneDocumentPreviewProps {
  document: MarkdownLoadResult;
  imageVersions: Record<string, number>;
  contentRef?: React.Ref<HTMLDivElement>;
  theme: string;
  windowId: string;
  tabId: string;
  onMediaOpen?: (target: MediaPreviewTarget) => void;
  onDrawioSave?: (source: string) => boolean | void | Promise<boolean | void>;
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
  onDrawioSave,
}: StandaloneDocumentPreviewProps) {
  if (document.kind === "svg") {
    return <div className="markdown-body standalone-document standalone-document--svg" ref={contentRef}>
      <ImageRenderer
        src={document.path}
        alt={getFileName(document.path)}
        baseDir={document.base_dir}
        imageVersions={imageVersions}
        onMediaOpen={onMediaOpen}
        codexSvgEditable={!document.path.toLowerCase().startsWith("spmd:")}
      />
    </div>;
  }

  if (document.kind === "mermaid") {
    const preview = <div className="markdown-body standalone-document standalone-document--mermaid" ref={contentRef}>
      <MermaidBlock
        source={document.content}
        theme={theme}
        mode="on"
        windowId={windowId}
        tabId={tabId}
        blockId="standalone-document"
        diagramIndex={0}
        diagramCount={1}
        headingTitle={getFileName(document.path)}
        onMediaOpen={onMediaOpen}
      />
    </div>;
    return document.path.toLowerCase().startsWith("spmd:") ? preview : <FileSvgCodexAction kind="mermaid" path={document.path}>{preview}</FileSvgCodexAction>;
  }

  if (document.kind === "tsv") {
    return <div className="markdown-body standalone-document standalone-document--tsv" ref={contentRef}>
      <DelimitedTableBlock language="tsv" source={document.content} headingLabel={<strong>{getFileName(document.path)}</strong>} />
    </div>;
  }

  if (document.kind === "drawio") {
    return <div className="markdown-body standalone-document standalone-document--drawio" ref={contentRef}>
      <DrawioBlock
        key={document.path}
        source={document.content}
        theme={theme}
        blockId="standalone-document"
        headingTitle={getFileName(document.path)}
        onSave={onDrawioSave}
        onMediaOpen={onMediaOpen}
      />
    </div>;
  }

  return null;
}
