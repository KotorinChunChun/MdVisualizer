import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ImageSize } from "../hooks/useInlineImageResize";
import { buildPresentationModel } from "../lib/presentationModel";
import type { PresentationHeading } from "../lib/presentationModel";
import { MarkdownPreview } from "./MarkdownPreview";
import type { MediaPreviewTarget } from "./MediaPreviewModal";
import "../styles/presentation.css";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return Boolean(target.closest("input, select, textarea, button, a, [contenteditable=''], [contenteditable='true']"));
}

function isModalOpen(documentRoot: Document): boolean {
  return [...documentRoot.querySelectorAll<HTMLElement>("dialog[open], [role='dialog'][aria-modal='true'], [aria-modal='true'], .modal, .mermaid-modal")]
    .some((element) => !element.hidden && element.style.display !== "none" && element.style.visibility !== "hidden");
}

function isWithinHorizontalScroller(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  for (let element: Element | null = target; element; element = element.parentElement) {
    const htmlElement = element as HTMLElement;
    const style = window.getComputedStyle(htmlElement);
    const overflowX = style.overflowX || style.overflow;
    if (htmlElement.scrollWidth > htmlElement.clientWidth && (overflowX === "auto" || overflowX === "scroll" || htmlElement.classList.contains("table-scroll") || htmlElement.classList.contains("mermaid-source"))) return true;
  }
  return false;
}

/** Kept exported so presentation keyboard exclusions stay regression-tested. */
export function shouldHandlePresentationArrowKey(event: KeyboardEvent, documentRoot: Document = document): boolean {
  return !event.defaultPrevented
    && !event.ctrlKey
    && !event.altKey
    && !event.metaKey
    && !isEditableTarget(event.target)
    && !isModalOpen(documentRoot)
    && !isWithinHorizontalScroller(event.target);
}

/**
 * Renders the immediate child headings for both the interactive slide and its
 * printed counterpart. Keeping the mapping here guarantees both surfaces use
 * the presentation model's title and ordering.
 */
export function PresentationChildHeadings({
  childIds,
  headings,
  currentHeadingId,
  onSelect,
  readOnly = false,
}: {
  childIds: string[];
  headings: Record<string, PresentationHeading>;
  currentHeadingId?: string;
  onSelect?: (headingId: string) => void;
  readOnly?: boolean;
}) {
  const children = childIds.flatMap((childId) => {
    const heading = headings[childId];
    return heading ? [{ id: childId, title: heading.title }] : [];
  });
  if (!children.length) return null;

  if (readOnly) {
    return <section className="presentation-children presentation-children--print" aria-label="下位見出し一覧">
      <h2>下位見出し</h2>
      <ol>
        {children.map((child) => <li key={child.id}>{child.title}</li>)}
      </ol>
    </section>;
  }

  return <nav className="presentation-children" aria-label="下位見出し">
    {children.map((child) => <button type="button" key={child.id} aria-current={child.id === currentHeadingId ? "location" : undefined} onClick={() => onSelect?.(child.id)}>
      <span>{child.title}</span>
      <span aria-hidden="true">→</span>
    </button>)}
  </nav>;
}

export function PresentationView({
  content,
  baseDir,
  imageVersions,
  theme,
  onError,
  mermaidMode,
  windowId,
  tabId,
  imageDisplaySizes,
  onOpenDocument,
  onOpenDocumentWindow,
  lineThreshold = 10,
  initialHeadingId,
  onPageChange,
  onMediaOpen,
  onBeforeNavigate,
}: {
  content: string;
  baseDir: string;
  imageVersions: Record<string, number>;
  theme: string;
  onError?: (message: string) => void;
  mermaidMode: "on" | "off" | "error-code" | "always-code";
  windowId: string;
  tabId: string;
  imageDisplaySizes: Record<string, ImageSize>;
  onOpenDocument?: (path: string) => void;
  onOpenDocumentWindow?: (path: string) => void;
  lineThreshold?: number;
  initialHeadingId?: string;
  onPageChange?: (headingId: string, sourceLine: number) => void;
  onMediaOpen?: (target: MediaPreviewTarget) => void;
  onBeforeNavigate?: () => void;
}) {
  const model = useMemo(() => buildPresentationModel(content, lineThreshold), [content, lineThreshold]);
  const initialIndex = () => Math.max(0, model.pages.findIndex((candidate) => candidate.id === initialHeadingId || candidate.mergedHeadingIds.includes(initialHeadingId ?? "")));
  const [pageIndex, setPageIndex] = useState(initialIndex);
  const [tocOpen, setTocOpen] = useState(false);
  const currentCrumbRef = useRef<HTMLButtonElement | null>(null);
  const synchronizedHeadingRef = useRef(initialHeadingId);
  const synchronizedModelRef = useRef(model);
  const pendingExternalPageRef = useRef<number | null>(null);
  const page = model.pages[Math.min(pageIndex, model.pages.length - 1)];

  if (synchronizedHeadingRef.current !== initialHeadingId || synchronizedModelRef.current !== model) {
    synchronizedHeadingRef.current = initialHeadingId;
    synchronizedModelRef.current = model;
    const requestedIndex = initialIndex();
    pendingExternalPageRef.current = requestedIndex === pageIndex ? null : requestedIndex;
  }

  useLayoutEffect(() => {
    const requestedIndex = pendingExternalPageRef.current;
    if (requestedIndex === null) return;
    if (pageIndex !== requestedIndex) {
      setPageIndex(requestedIndex);
      return;
    }
    pendingExternalPageRef.current = null;
  }, [content, initialHeadingId, model, pageIndex, tabId]);
  useEffect(() => {
    if (pendingExternalPageRef.current !== null) return;
    onPageChange?.(page.id, page.sourceLine);
  }, [onPageChange, page.id, page.sourceLine]);
  useEffect(() => {
    currentCrumbRef.current?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [pageIndex]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandlePresentationArrowKey(event)) return;
      if (event.key === "ArrowLeft" && pageIndex > 0) {
        event.preventDefault();
        onBeforeNavigate?.();
        setPageIndex((current) => current - 1);
      } else if (event.key === "ArrowRight" && pageIndex < model.pages.length - 1) {
        event.preventDefault();
        onBeforeNavigate?.();
        setPageIndex((current) => current + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [model.pages.length, onBeforeNavigate, pageIndex]);

  const jumpToHeading = (headingId: string) => {
    const index = model.pages.findIndex((candidate) => candidate.id === headingId || candidate.mergedHeadingIds.includes(headingId));
    if (index >= 0 && index !== pageIndex) {
      onBeforeNavigate?.();
      setPageIndex(index);
    }
  };
  const currentHeadingId = page.mergedHeadingIds[page.mergedHeadingIds.length - 1] ?? page.id;
  const renderTocItems = (ids: string[]): React.ReactNode => <ul>
    {ids.map((id) => {
      const heading = model.headings[id];
      if (!heading) return null;
      return <li key={id}>
        <button
          type="button"
          aria-current={id === currentHeadingId ? "location" : undefined}
          onClick={() => {
            jumpToHeading(id);
            if (typeof window.matchMedia !== "function" || !window.matchMedia("(min-width: 1500px)").matches) setTocOpen(false);
          }}
        >
          {heading.title}
        </button>
        {heading.childIds.length > 0 && renderTocItems(heading.childIds)}
      </li>;
    })}
  </ul>;

  return <section className="presentation-view" aria-label="階層型プレゼンテーション">
    <div className="presentation-topbar">
      <button type="button" className="presentation-toc-toggle" aria-expanded={tocOpen} aria-controls="presentation-toc" onClick={() => setTocOpen((open) => !open)}>
        ☰ 目次
      </button>
      <nav className="presentation-breadcrumbs" aria-label="見出し階層">
        {page.breadcrumbs.map((crumb, index) => <span key={crumb.id}>
          {index > 0 && <span aria-hidden="true">›</span>}
          <button type="button" ref={index === page.breadcrumbs.length - 1 ? currentCrumbRef : undefined} onClick={() => jumpToHeading(crumb.id)} title={crumb.title}>
            {crumb.title} ({crumb.index}/{crumb.total})
          </button>
        </span>)}
      </nav>
    </div>
    <div className={`presentation-main${tocOpen ? " has-toc" : ""}`}>
      {tocOpen && <>
        <button type="button" className="presentation-toc-backdrop" aria-label="目次を閉じる" onClick={() => setTocOpen(false)} />
        <aside id="presentation-toc" className="presentation-toc">
          <div className="presentation-toc__header">
            <strong>目次</strong>
            <button type="button" aria-label="目次を閉じる" onClick={() => setTocOpen(false)}>×</button>
          </div>
          <nav aria-label="文書全体の目次">{renderTocItems(model.rootIds)}</nav>
        </aside>
      </>}
      <div className="presentation-stage">
        <MarkdownPreview
          content={page.markdown}
          baseDir={baseDir}
          imageVersions={imageVersions}
          theme={theme}
          onError={onError}
          mermaidMode={mermaidMode}
          windowId={windowId}
          tabId={`${tabId}:${page.id}`}
          imageDisplaySizes={imageDisplaySizes}
          onOpenDocument={onOpenDocument} onOpenDocumentWindow={onOpenDocumentWindow}
          presentationMode
          onMediaOpen={onMediaOpen}
        />
        <PresentationChildHeadings childIds={page.childIds} headings={model.headings} currentHeadingId={currentHeadingId} onSelect={jumpToHeading} />
      </div>
    </div>
    <div className="presentation-print-pages" aria-hidden="true">
      {model.pages.map((printPage) => <article className="presentation-print-page" key={printPage.id}>
        <MarkdownPreview content={printPage.markdown} baseDir={baseDir} imageVersions={imageVersions} theme={theme} onError={onError} mermaidMode={mermaidMode} windowId={windowId} tabId={`${tabId}:print:${printPage.id}`} imageDisplaySizes={imageDisplaySizes} onOpenDocument={onOpenDocument} onOpenDocumentWindow={onOpenDocumentWindow} presentationMode onMediaOpen={onMediaOpen} />
        <PresentationChildHeadings childIds={printPage.childIds} headings={model.headings} readOnly />
      </article>)}
    </div>
    <footer className="presentation-navigation">
      <button type="button" disabled={pageIndex === 0} onClick={() => { onBeforeNavigate?.(); setPageIndex((current) => current - 1); }}>← 前へ</button>
      <span>{pageIndex + 1} / {model.pages.length}</span>
      <button type="button" disabled={pageIndex >= model.pages.length - 1} onClick={() => { onBeforeNavigate?.(); setPageIndex((current) => current + 1); }}>次へ →</button>
    </footer>
  </section>;
}
