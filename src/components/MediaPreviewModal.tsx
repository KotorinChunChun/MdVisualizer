import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MermaidToolbar } from "./MermaidToolbar";
import { ImageMetadataEditor } from "./ImageMetadataEditor";
import { ExternalActions } from "./ExternalActions";
import type { ExternalAppConfig } from "../types/settings";
import type { AssetConversionContext } from "../lib/assetConversion";

export type MediaPreviewContent =
  | { kind: "image"; src: string; alt: string }
  | { kind: "svg"; svg: string; alt: string };

export interface ImageEditContext {
  markdownPath: string;
  imagePath: string;
  source: string;
  sourceOffset: number;
  caption: string;
}

export interface MediaPreviewTarget {
  content: MediaPreviewContent;
  cropTarget?: import("../hooks/useCropEditor").CropTarget | null;
  editTarget?: import("../hooks/useCropEditor").ImageEditTarget | null;
  mermaidSource?: string;
  imageContext?: ImageEditContext;
  conversionContext?: AssetConversionContext;
  svgEditTarget?: import("../hooks/useCropEditor").SharePointAssetEditContext & { svg: string; filename: string };
  editDisabledReason?: string;
}

export interface MediaPreviewViewState {
  mode: "fit" | "actual";
  scale: number;
  display: "diagram" | "code";
  scrollLeft: number;
  scrollTop: number;
}

interface ZoomAnchor {
  viewportX: number;
  viewportY: number;
  mediaX: number;
  mediaY: number;
}

function svgIntrinsicSize(svg: string): { width: number; height: number } {
  try {
    const element = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    const viewBox = element.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
      return { width: viewBox[2], height: viewBox[3] };
    }
    const width = Number.parseFloat(element.getAttribute("width") ?? "");
    const height = Number.parseFloat(element.getAttribute("height") ?? "");
    if (width > 0 && height > 0) return { width, height };
  } catch {
    // Invalid SVG is handled by the caller's render/error state.
  }
  return { width: 1000, height: 600 };
}

export function MediaPreviewModal({
  content,
  onClose,
  onActivate,
  editDisabledReason,
  onCrop,
  mermaidSource,
  imageContext,
  onSaveCaption,
  onRenameImage,
  imageApps = [],
  onOpenImageApp,
  conversionContext,
  onConvertAsset,
  initialViewState,
  onViewStateChange,
}: {
  content: MediaPreviewContent;
  onClose: () => void;
  onActivate?: () => void;
  editDisabledReason?: string;
  onCrop?: () => void;
  mermaidSource?: string;
  imageContext?: ImageEditContext;
  onSaveCaption?: (context: ImageEditContext, caption: string) => Promise<void>;
  onRenameImage?: (context: ImageEditContext, filename: string) => Promise<void>;
  imageApps?: ExternalAppConfig[];
  onOpenImageApp?: (app: ExternalAppConfig, context: ImageEditContext) => void;
  conversionContext?: AssetConversionContext;
  onConvertAsset?: (context: AssetConversionContext) => Promise<void>;
  initialViewState?: MediaPreviewViewState | null;
  onViewStateChange?: (state: MediaPreviewViewState) => void;
}) {
  const svgSize = useMemo(
    () => content.kind === "svg" ? svgIntrinsicSize(content.svg) : null,
    [content],
  );
  const [mode, setMode] = useState<"fit" | "actual">(initialViewState?.mode ?? "fit");
  const [scale, setScale] = useState(initialViewState?.scale ?? 1);
  const [imageSize, setImageSize] = useState({ width: 1000, height: 600 });
  const [display, setDisplay] = useState<"diagram" | "code">(initialViewState?.display ?? "diagram");
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const scaleRef = useRef(initialViewState?.scale ?? 1);
  const initialViewApplied = useRef(false);
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);
  const intrinsic = content.kind === "svg" ? svgSize! : imageSize;
  const fitScale = viewportSize.width > 0 && viewportSize.height > 0
    ? Math.min(viewportSize.width / intrinsic.width, viewportSize.height / intrinsic.height)
    : 1;
  const effectiveScale = (mode === "fit" ? fitScale : 1) * scale;
  const mediaWidth = intrinsic.width * effectiveScale;
  const mediaHeight = intrinsic.height * effectiveScale;
  const stageWidth = Math.max(viewportSize.width, mediaWidth);
  const stageHeight = Math.max(viewportSize.height, mediaHeight);
  const mediaLeft = Math.max(0, (stageWidth - mediaWidth) / 2);
  const mediaTop = Math.max(0, (stageHeight - mediaHeight) / 2);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateSize = () => setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    updateSize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateSize);
    observer?.observe(viewport);
    window.addEventListener("resize", updateSize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || display === "code" || viewportSize.width <= 0 || viewportSize.height <= 0) return;
    const frame = window.requestAnimationFrame(() => {
      if (initialViewState && !initialViewApplied.current) {
        viewport.scrollLeft = Math.max(0, initialViewState.scrollLeft);
        viewport.scrollTop = Math.max(0, initialViewState.scrollTop);
        initialViewApplied.current = true;
      } else {
        viewport.scrollLeft = Math.max(0, (stageWidth - viewport.clientWidth) / 2);
        viewport.scrollTop = Math.max(0, (stageHeight - viewport.clientHeight) / 2);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [content.kind, content.kind === "image" ? content.src : content.svg, display, mode, intrinsic.width, intrinsic.height, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    const viewport = viewportRef.current;
    onViewStateChange?.({
      mode,
      scale,
      display,
      scrollLeft: viewport?.scrollLeft ?? initialViewState?.scrollLeft ?? 0,
      scrollTop: viewport?.scrollTop ?? initialViewState?.scrollTop ?? 0,
    });
  }, [display, mode, onViewStateChange, scale]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const anchor = zoomAnchorRef.current;
    if (!viewport || !anchor || display === "code") return;
    viewport.scrollLeft = Math.max(0, mediaLeft + anchor.mediaX * effectiveScale - anchor.viewportX);
    viewport.scrollTop = Math.max(0, mediaTop + anchor.mediaY * effectiveScale - anchor.viewportY);
    zoomAnchorRef.current = null;
  }, [display, effectiveScale, mediaLeft, mediaTop]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const toggleMode = () => {
    setMode((current) => current === "fit" ? "actual" : "fit");
    scaleRef.current = 1;
    setScale(1);
  };

  return createPortal(<div
    className="media-preview"
    role="dialog"
    aria-modal="true"
    aria-label={`${content.alt || "メディア"}の拡大表示`}
    onClick={onClose}
  >
    <div className="media-preview__toolbar" onClick={(event) => event.stopPropagation()}>
      {mermaidSource && content.kind === "svg" && <MermaidToolbar source={mermaidSource} svg={content.svg} display={display} onDisplayChange={setDisplay} />}
      {imageContext && onOpenImageApp && imageApps.length > 0 && <ExternalActions
        apps={imageApps}
        title=""
        compact
        onExecute={(app) => onOpenImageApp(app, imageContext)}
      />}
      {onCrop && <button type="button" onClick={onCrop}>クロップ</button>}
      {(onActivate || editDisabledReason) && <button type="button" onClick={onActivate} disabled={!onActivate} title={editDisabledReason}>画像編集</button>}
      {conversionContext && onConvertAsset && <button type="button" disabled={converting} onClick={() => {
        setConverting(true); setConversionError(null);
        void onConvertAsset(conversionContext).catch((error) => setConversionError(error instanceof Error ? error.message : String(error))).finally(() => setConverting(false));
      }}>{converting ? "変換中…" : conversionContext.storage === "embedded" ? "同フォルダのファイルへ変換" : "埋め込みへ変換"}</button>}
      {imageContext && onSaveCaption && onRenameImage && <button type="button" aria-expanded={metadataOpen} onClick={() => setMetadataOpen((open) => !open)}>画像情報</button>}
      <button type="button" className="media-preview__mode" onClick={toggleMode}>
        {mode === "fit" ? "1:1表示" : "全体表示"}
      </button>
      <button type="button" className="media-preview__close" aria-label="拡大表示を閉じる" onClick={onClose}>×</button>
    </div>
    {conversionError && <p className="media-preview__conversion-error" role="alert" onClick={(event) => event.stopPropagation()}>{conversionError}</p>}
    {metadataOpen && imageContext && onSaveCaption && onRenameImage && <div onClick={(event) => event.stopPropagation()}>
      <ImageMetadataEditor context={imageContext} onSaveCaption={onSaveCaption} onRename={onRenameImage} />
    </div>}
    <div
      className={`media-preview__viewport${display === "code" ? " is-code" : ""}`}
      ref={viewportRef}
      onScroll={(event) => onViewStateChange?.({ mode, scale, display, scrollLeft: event.currentTarget.scrollLeft, scrollTop: event.currentTarget.scrollTop })}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => {
        if (!event.ctrlKey) return;
        event.preventDefault(); event.stopPropagation();
        const viewport = event.currentTarget;
        const rect = viewport.getBoundingClientRect();
        const viewportX = event.clientX - rect.left;
        const viewportY = event.clientY - rect.top;
        const currentScale = scaleRef.current;
        const currentEffectiveScale = (mode === "fit" ? fitScale : 1) * currentScale;
        zoomAnchorRef.current = {
          viewportX,
          viewportY,
          mediaX: (viewport.scrollLeft + viewportX - mediaLeft) / currentEffectiveScale,
          mediaY: (viewport.scrollTop + viewportY - mediaTop) / currentEffectiveScale,
        };
        const deltaPixels = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? Math.max(1, viewport.clientHeight) : 1);
        const nextScale = Math.min(8, Math.max(0.1, currentScale * Math.exp(-deltaPixels * 0.002)));
        scaleRef.current = nextScale;
        setScale(nextScale);
      }}
      onPointerDown={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        const viewport = event.currentTarget;
        panRef.current = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
        viewport.setPointerCapture(event.pointerId);
        setPanning(true);
      }}
      onPointerMove={(event) => {
        const pan = panRef.current;
        if (!pan) return;
        event.currentTarget.scrollLeft = pan.left - (event.clientX - pan.x);
        event.currentTarget.scrollTop = pan.top - (event.clientY - pan.y);
      }}
      onPointerUp={(event) => {
        if (!panRef.current) return;
        panRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        setPanning(false);
      }}
      onPointerCancel={() => { panRef.current = null; setPanning(false); }}
      onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}
    >
      {display === "code" && mermaidSource
        ? <pre className="mermaid-source media-preview__source"><code>{mermaidSource}</code></pre>
        : <div className="media-preview__stage" style={{ width: `${stageWidth}px`, height: `${stageHeight}px` }}>
          <div
            className={`media-preview__transform is-${mode}`}
            style={{
              width: `${mediaWidth}px`,
              height: `${mediaHeight}px`,
              left: `${mediaLeft}px`,
              top: `${mediaTop}px`,
            }}
            onClick={(event) => {
              event.stopPropagation();
              onActivate?.();
            }}
          >
            {content.kind === "image"
              ? <img
                src={content.src}
                alt={content.alt}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                    setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
                  }
                }}
              />
              : <div className="media-preview__svg" dangerouslySetInnerHTML={{ __html: content.svg }} />}
          </div>
        </div>}
    </div>
    <output className="media-preview__scale">
      {mode === "fit" ? "全体表示" : "1:1"} · {Math.round(effectiveScale * 100)}%{panning ? " · パン中" : ""}
    </output>
  </div>, document.body);
}
