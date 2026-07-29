import { useEffect, useMemo, useRef, useState } from "react";
import type { CropTarget } from "../hooks/useCropEditor";
import type { ImageSize } from "../hooks/useInlineImageResize";
import { buildPresentationModel } from "../lib/presentationModel";
import { MarkdownPreview } from "./MarkdownPreview";
import { PresentationImageModal } from "./PresentationImageModal";
import type { PresentationImageTarget } from "./ImageRenderer";
import "../styles/presentation.css";

export function PresentationView({
  content,
  baseDir,
  imageVersions,
  onStartCrop,
  theme,
  onError,
  mermaidMode,
  windowId,
  tabId,
  imageDisplaySizes,
  onOpenDocument,
  lineThreshold = 10,
  initialHeadingId,
  onPageChange,
}: {
  content: string;
  baseDir: string;
  imageVersions: Record<string, number>;
  onStartCrop: (target: CropTarget) => void;
  theme: string;
  onError?: (message: string) => void;
  mermaidMode: "on" | "off" | "error-code" | "always-code";
  windowId: string;
  tabId: string;
  imageDisplaySizes: Record<string, ImageSize>;
  onOpenDocument?: (path: string) => void;
  lineThreshold?: number;
  initialHeadingId?: string;
  onPageChange?: (headingId: string) => void;
}) {
  const model = useMemo(() => buildPresentationModel(content, lineThreshold), [content, lineThreshold]);
  const initialIndex = () => Math.max(0, model.pages.findIndex((candidate) => candidate.id === initialHeadingId || candidate.mergedChildId === initialHeadingId));
  const [pageIndex, setPageIndex] = useState(initialIndex);
  const [imageTarget, setImageTarget] = useState<PresentationImageTarget | null>(null);
  const currentCrumbRef = useRef<HTMLButtonElement | null>(null);
  const page = model.pages[Math.min(pageIndex, model.pages.length - 1)];

  useEffect(() => setPageIndex(initialIndex()), [content, tabId, initialHeadingId, model]);
  useEffect(() => onPageChange?.(page.id), [onPageChange, page.id]);
  useEffect(() => {
    currentCrumbRef.current?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [pageIndex]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (imageTarget || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPageIndex((current) => Math.max(0, current - 1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setPageIndex((current) => Math.min(model.pages.length - 1, current + 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [imageTarget, model.pages.length]);

  const jumpToHeading = (headingId: string) => {
    const index = model.pages.findIndex((candidate) => candidate.id === headingId || candidate.mergedChildId === headingId);
    if (index >= 0) setPageIndex(index);
  };

  return <section className="presentation-view" aria-label="階層型プレゼンテーション">
    <nav className="presentation-breadcrumbs" aria-label="見出し階層">
      {page.breadcrumbs.map((crumb, index) => <span key={crumb.id}>
        {index > 0 && <span aria-hidden="true">›</span>}
        <button type="button" ref={index === page.breadcrumbs.length - 1 ? currentCrumbRef : undefined} onClick={() => jumpToHeading(crumb.id)} title={crumb.title}>
          {crumb.title} ({crumb.index}/{crumb.total})
        </button>
      </span>)}
    </nav>
    <div className="presentation-stage">
      <MarkdownPreview
        content={page.markdown}
        baseDir={baseDir}
        imageVersions={imageVersions}
        onStartCrop={onStartCrop}
        theme={theme}
        onError={onError}
        mermaidMode={mermaidMode}
        windowId={windowId}
        tabId={`${tabId}:${page.id}`}
        imageDisplaySizes={imageDisplaySizes}
        onOpenDocument={onOpenDocument}
        presentationMode
        onPresentationImageOpen={setImageTarget}
      />
      {page.childIds.length > 0 && <nav className="presentation-children" aria-label="下位見出し">
        {page.childIds.map((childId) => <button type="button" key={childId} onClick={() => jumpToHeading(childId)}>
          <span>{model.headings[childId].title}</span>
          <span aria-hidden="true">→</span>
        </button>)}
      </nav>}
    </div>
    <footer className="presentation-navigation">
      <button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((current) => current - 1)}>← 前へ</button>
      <span>{pageIndex + 1} / {model.pages.length}</span>
      <button type="button" disabled={pageIndex >= model.pages.length - 1} onClick={() => setPageIndex((current) => current + 1)}>次へ →</button>
    </footer>
    {imageTarget && <PresentationImageModal target={imageTarget} onClose={() => setImageTarget(null)} onEdit={(target) => { setImageTarget(null); onStartCrop(target); }} />}
  </section>;
}
