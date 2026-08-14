import { useEffect, useMemo, useRef, useState } from "react";
import { classifyDrawioSource, prepareDrawioLoad } from "../lib/drawio";
import { sanitizeSvgXml } from "../lib/svgSafety";
import { MermaidBlock } from "./MermaidBlock";
import { MermaidToolbar } from "./MermaidToolbar";
import { DrawioEditorModal } from "./DrawioEditorModal";
import type { MediaPreviewTarget } from "./MediaPreviewModal";
import "../styles/drawio.css";

declare global {
  interface Window { GraphViewer?: { processElements: () => void } }
}

let viewerPromise: Promise<void> | null = null;
function ensureDrawioViewer(): Promise<void> {
  if (window.GraphViewer) return Promise.resolve();
  if (viewerPromise) return viewerPromise;
  viewerPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("markdown-viewer-drawio-script") as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.id = "markdown-viewer-drawio-script";
      script.src = "https://viewer.diagrams.net/js/viewer-static.min.js";
      script.async = true;
      script.referrerPolicy = "no-referrer";
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => {
      script.remove();
      viewerPromise = null;
      reject(new Error("draw.ioビューアーを読み込めませんでした。"));
    }, { once: true });
  });
  return viewerPromise;
}

export function drawioViewerConfig(xml: string): Record<string, unknown> {
  return {
    highlight: "#0000ff",
    nav: false,
    resize: false,
    responsive: true,
    border: 0,
    center: true,
    forceCenter: true,
    "auto-fit": true,
    lightbox: false,
    xml,
  };
}

export function fitDrawioSvgToContent(svg: SVGSVGElement, padding = 12): string {
  const fitted = svg.cloneNode(true) as SVGSVGElement;
  try {
    const bounds = svg.getBBox();
    if ([bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
      && bounds.width > 0
      && bounds.height > 0) {
      const viewBox = [
        bounds.x - padding,
        bounds.y - padding,
        bounds.width + padding * 2,
        bounds.height + padding * 2,
      ].join(" ");
      fitted.setAttribute("viewBox", viewBox);
      fitted.setAttribute("preserveAspectRatio", "xMidYMid meet");
    }
  } catch {
    // Empty diagrams and jsdom-like SVG implementations may not expose a
    // measurable bounding box. The viewer-provided viewBox remains usable.
  }
  fitted.removeAttribute("width");
  fitted.removeAttribute("height");
  const style = fitted.getAttribute("style");
  if (style) {
    const responsiveStyle = style
      .split(";")
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration && !/^(?:min-|max-)?(?:width|height)\s*:/i.test(declaration));
    if (responsiveStyle.length > 0) fitted.setAttribute("style", `${responsiveStyle.join(";")};`);
    else fitted.removeAttribute("style");
  }
  return fitted.outerHTML;
}

export function DrawioBlock({ source, theme, blockId, onSave, onMediaOpen }: {
  source: string;
  theme: string;
  blockId: string;
  onSave?: (source: string) => boolean | void;
  onMediaOpen?: (target: MediaPreviewTarget) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [renderedSvg, setRenderedSvg] = useState<string>();
  const [display, setDisplay] = useState<"diagram" | "code">("diagram");
  const viewerRef = useRef<HTMLDivElement>(null);
  const kind = useMemo(() => classifyDrawioSource(source), [source]);
  const load = useMemo(() => {
    try { return prepareDrawioLoad(source); }
    catch (error) { return error instanceof Error ? error : new Error(String(error)); }
  }, [source]);
  const safeSourceSvg = useMemo(() => {
    if (kind !== "svg") return undefined;
    try { return sanitizeSvgXml(source); }
    catch { return undefined; }
  }, [kind, source]);

  useEffect(() => {
    setDisplay("diagram");
    setViewerError(null);
    setRenderedSvg(safeSourceSvg);
  }, [safeSourceSvg, source]);

  useEffect(() => {
    if (display !== "diagram" || load instanceof Error || "descriptor" in load || kind === "svg") return;
    const element = viewerRef.current;
    if (!element) return;
    element.replaceChildren();
    element.setAttribute("data-mxgraph", JSON.stringify(drawioViewerConfig(load.xml)));
    let disposed = false;
    let animationFrame = 0;
    const captureRenderedSvg = () => {
      if (disposed) return;
      const svg = element.querySelector<SVGSVGElement>("svg");
      if (svg) setRenderedSvg(fitDrawioSvgToContent(svg));
    };
    const observer = new MutationObserver(captureRenderedSvg);
    observer.observe(element, { childList: true, subtree: true });
    void ensureDrawioViewer().then(() => {
      if (disposed) return;
      window.GraphViewer?.processElements();
      animationFrame = window.requestAnimationFrame(captureRenderedSvg);
    }).catch((error) => { if (!disposed) setViewerError(String(error)); });
    return () => {
      disposed = true;
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, [display, kind, load]);

  const label = kind === "svg" ? "SVG → draw.io" : kind === "mermaid" ? "Mermaid → draw.io" : kind === "compressed" ? "draw.io（圧縮データ）" : "draw.io";
  const svgPreview = (svg: string, alt: string) => {
    const content = <div className="drawio-block__svg" dangerouslySetInnerHTML={{ __html: svg }} />;
    return onMediaOpen
      ? <button
        type="button"
        className="drawio-block__zoom"
        aria-label="図を拡大"
        onClick={() => onMediaOpen({ content: { kind: "svg", svg, alt } })}
      >{content}</button>
      : content;
  };
  let preview;
  if (display === "code") preview = <pre className="drawio-block__source"><code>{source}</code></pre>;
  else if (load instanceof Error) preview = <p className="drawio-block__error">{load.message}</p>;
  else if (kind === "svg") preview = safeSourceSvg
    ? svgPreview(safeSourceSvg, "draw.io図")
    : <p className="drawio-block__error">SVGを安全に表示できません。</p>;
  else if (kind === "mermaid") preview = <MermaidBlock
    source={source}
    theme={theme}
    mode="on"
    blockId={`drawio-${blockId}`}
    diagramIndex={0}
    diagramCount={1}
    showToolbar={false}
    onRenderedSvg={setRenderedSvg}
    onMediaOpen={onMediaOpen}
  />;
  else if (renderedSvg) preview = svgPreview(renderedSvg, "draw.io図");
  else preview = viewerError
    ? <div className="drawio-block__fallback"><p>{viewerError}</p><pre><code>{source}</code></pre></div>
    : <div ref={viewerRef} className="drawio-block__viewer mxgraph" />;

  return <div className="drawio-block" data-drawio-block={blockId}>
    <div className="drawio-block__toolbar">
      <span>{label}</span>
      <MermaidToolbar
        source={source}
        svg={renderedSvg}
        display={display}
        onDisplayChange={setDisplay}
        ariaLabel="draw.io操作"
        allowFileCopy={false}
        onEdit={onSave ? () => setEditing(true) : undefined}
      />
    </div>
    <div className="drawio-block__preview">{preview}</div>
    {editing && !(load instanceof Error) && <DrawioEditorModal source={source} onSave={onSave!} onCancel={() => setEditing(false)} />}
  </div>;
}
