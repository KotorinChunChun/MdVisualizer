import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MermaidToolbar } from "./MermaidToolbar";

export type MediaPreviewContent =
  | { kind: "image"; src: string; alt: string }
  | { kind: "svg"; svg: string; alt: string };

export interface MediaPreviewTarget {
  content: MediaPreviewContent;
  cropTarget?: import("../hooks/useCropEditor").CropTarget | null;
  mermaidSource?: string;
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
  mermaidSource,
}: {
  content: MediaPreviewContent;
  onClose: () => void;
  onActivate?: () => void;
  mermaidSource?: string;
}) {
  const svgSize = useMemo(
    () => content.kind === "svg" ? svgIntrinsicSize(content.svg) : null,
    [content],
  );
  const [mode, setMode] = useState<"fit" | "actual">("fit");
  const [scale, setScale] = useState(1);
  const [origin, setOrigin] = useState("50% 50%");
  const [imageSize, setImageSize] = useState({ width: 1000, height: 600 });
  const [display, setDisplay] = useState<"diagram" | "code">("diagram");
  const intrinsic = content.kind === "svg" ? svgSize! : imageSize;

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
    setScale(1);
    setOrigin("50% 50%");
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
      <button type="button" className="media-preview__mode" onClick={toggleMode}>
        {mode === "fit" ? "1:1表示" : "全体表示"}
      </button>
      <button type="button" className="media-preview__close" aria-label="拡大表示を閉じる" onClick={onClose}>×</button>
    </div>
    <div
      className={`media-preview__viewport${display === "code" ? " is-code" : ""}`}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => {
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        if (bounds.width > 0 && bounds.height > 0) {
          setOrigin(`${((event.clientX - bounds.left) / bounds.width) * 100}% ${((event.clientY - bounds.top) / bounds.height) * 100}%`);
        }
        setScale((current) => Math.min(8, Math.max(0.1, current * (event.deltaY < 0 ? 1.2 : 1 / 1.2))));
      }}
    >
      {display === "code" && mermaidSource
        ? <pre className="mermaid-source media-preview__source"><code>{mermaidSource}</code></pre>
        : <div
        className={`media-preview__transform is-${mode}`}
        style={{
          ...(mode === "actual" ? { width: `${intrinsic.width}px`, height: `${intrinsic.height}px` } : {}),
          transform: `scale(${scale})`,
          transformOrigin: origin,
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
      </div>}
    </div>
    <output className="media-preview__scale">
      {mode === "fit" ? "全体表示" : "1:1"} · {Math.round(scale * 100)}%
    </output>
  </div>, document.body);
}
