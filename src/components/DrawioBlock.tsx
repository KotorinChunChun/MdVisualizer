import { useEffect, useMemo, useRef, useState } from "react";
import { classifyDrawioSource, prepareDrawioLoad } from "../lib/drawio";
import { normalizeSvgForClipboard } from "../lib/mermaidClipboard";
import { sanitizeSvgXml } from "../lib/svgSafety";
import { MermaidBlock } from "./MermaidBlock";
import { MermaidToolbar } from "./MermaidToolbar";
import { DrawioEditorModal } from "./DrawioEditorModal";
import type { MediaPreviewTarget } from "./MediaPreviewModal";
import "../styles/drawio.css";

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

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function drawioViewerDocument(xml: string): string {
  const config = escapeHtmlAttribute(JSON.stringify(drawioViewerConfig(xml)));
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}.mxgraph{width:100%;height:100%;min-height:0}</style></head><body><div class="mxgraph" data-mxgraph="${config}"></div><script>(()=>{const send=()=>{const svg=document.querySelector('svg');if(svg)parent.postMessage({type:'markdown-viewer-drawio-svg',svg:svg.outerHTML},'*')};window.captureDrawioSvg=send;new MutationObserver(send).observe(document.body,{subtree:true,childList:true,attributes:true})})()</script><script src="https://viewer.diagrams.net/js/viewer-static.min.js" referrerpolicy="no-referrer" onload="GraphViewer.processElements();captureDrawioSvg()"></script></body></html>`;
}

/** Returns the exact responsive height needed to show an SVG viewBox without clipping or trailing blank space. */
export function drawioPreviewHeight(svgSource: string, availableWidth: number): number | null {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return null;
  const parsed = new DOMParser().parseFromString(svgSource, "image/svg+xml");
  const svg = parsed.documentElement;
  if (parsed.querySelector("parsererror") || svg.localName !== "svg") return null;
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) return null;
  return Math.max(1, Math.ceil(availableWidth * viewBox[3] / viewBox[2]));
}

export function fitDrawioSvgToContent(svg: SVGSVGElement, padding = 12): string {
  const fitted = svg.cloneNode(true) as SVGSVGElement;
  const existingViewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const hasUsableViewBox = existingViewBox?.length === 4
    && existingViewBox.every(Number.isFinite)
    && existingViewBox[2] > 0
    && existingViewBox[3] > 0;
  if (!hasUsableViewBox) {
    try {
      const bounds = svg.getBBox();
      if ([bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
        && bounds.width > 0
        && bounds.height > 0) {
        fitted.setAttribute("viewBox", [
          bounds.x - padding,
          bounds.y - padding,
          bounds.width + padding * 2,
          bounds.height + padding * 2,
        ].join(" "));
      }
    } catch {
      // Empty diagrams and jsdom-like SVG implementations may not expose a
      // measurable bounding box. Existing dimensions remain usable.
    }
  }
  fitted.setAttribute("preserveAspectRatio", "xMidYMid meet");
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

export function DrawioBlock({ source, theme, blockId, storage, onStorageConvert, onSave, onMediaOpen }: {
  source: string;
  theme: string;
  blockId: string;
  storage?: "embedded" | "external";
  onStorageConvert?: () => boolean | void | Promise<boolean | void>;
  onSave?: (source: string) => boolean | void | Promise<boolean | void>;
  onMediaOpen?: (target: MediaPreviewTarget) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [renderedSvg, setRenderedSvg] = useState<string>();
  const [viewerHeight, setViewerHeight] = useState(180);
  const [display, setDisplay] = useState<"diagram" | "code">("diagram");
  const [convertingStorage, setConvertingStorage] = useState(false);
  const viewerRef = useRef<HTMLIFrameElement>(null);
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
  const viewerDocument = useMemo(
    () => load instanceof Error || "descriptor" in load || kind === "svg" ? undefined : drawioViewerDocument(load.xml),
    [kind, load],
  );

  useEffect(() => {
    setDisplay("diagram");
    setViewerError(null);
    setRenderedSvg(safeSourceSvg);
  }, [safeSourceSvg, source]);

  useEffect(() => {
    if (display !== "diagram" || !viewerDocument) return;
    const frame = viewerRef.current;
    if (!frame) return;
    let timeout = 0;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow
        || event.data?.type !== "markdown-viewer-drawio-svg"
        || typeof event.data.svg !== "string") return;
      try {
        window.clearTimeout(timeout);
        const parsed = new DOMParser().parseFromString(event.data.svg, "image/svg+xml");
        const svg = parsed.documentElement;
        if (parsed.querySelector("parsererror") || svg.localName !== "svg") throw new Error("draw.io SVGを解析できません。");
        setRenderedSvg(normalizeSvgForClipboard(fitDrawioSvgToContent(svg as unknown as SVGSVGElement)));
        setViewerError(null);
      } catch (error) {
        setViewerError(error instanceof Error ? error.message : String(error));
      }
    };
    window.addEventListener("message", onMessage);
    timeout = window.setTimeout(() => setViewerError((current) => current ?? "draw.ioビューアーを読み込めませんでした。"), 20_000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeout);
    };
  }, [display, viewerDocument]);

  useEffect(() => {
    if (display !== "diagram" || !viewerDocument || !renderedSvg) return;
    const frame = viewerRef.current;
    if (!frame) return;
    const updateHeight = () => {
      const width = frame.getBoundingClientRect().width || frame.clientWidth;
      const height = drawioPreviewHeight(renderedSvg, width);
      if (height !== null) setViewerHeight((current) => current === height ? current : height);
    };
    updateHeight();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateHeight);
    observer?.observe(frame);
    window.addEventListener("resize", updateHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [display, renderedSvg, viewerDocument]);

  const label = kind === "svg" ? "SVG → draw.io" : kind === "mermaid" ? "Mermaid → draw.io" : kind === "compressed" ? "draw.io（圧縮データ）" : "draw.io";
  const svgPreview = (svg: string, alt: string) => {
    const content = <div className="drawio-block__svg" dangerouslySetInnerHTML={{ __html: svg }} />;
    return onMediaOpen
      ? <button
        type="button"
        className="drawio-block__zoom"
        aria-label="図を拡大"
        onClick={() => onMediaOpen({ content: { kind: "svg", svg, alt }, diagramSource: source, diagramKind: "drawio" })}
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
  else if (viewerError) preview = <div className="drawio-block__fallback"><p>{viewerError}</p><pre><code>{source}</code></pre></div>;
  else {
    const viewerHost = <iframe
      ref={viewerRef}
      className="drawio-block__viewer-frame"
      title="draw.ioプレビュー"
      srcDoc={viewerDocument}
      style={{ height: viewerHeight }}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
    />;
    preview = onMediaOpen
      ? <button
        type="button"
        className="drawio-block__zoom"
        aria-label="図を拡大"
        aria-disabled={!renderedSvg}
        onClick={() => renderedSvg && onMediaOpen({ content: { kind: "svg", svg: renderedSvg, alt: "draw.io図" }, diagramSource: source, diagramKind: "drawio" })}
      >{viewerHost}</button>
      : viewerHost;
  }

  return <div className="drawio-block" data-drawio-block={blockId}>
    <div className="drawio-block__toolbar diagram-block__header">
      <span>{label}</span>
      <MermaidToolbar
        source={source}
        svg={renderedSvg}
        display={display}
        onDisplayChange={setDisplay}
        ariaLabel="draw.io操作"
        fileDiagramKind="drawio"
        onEdit={onSave ? () => setEditing(true) : undefined}
      />
      {storage && onStorageConvert && <button
        className="diagram-action-button"
        type="button"
        disabled={convertingStorage}
        onClick={() => {
          setConvertingStorage(true);
          void Promise.resolve()
            .then(() => onStorageConvert())
            .catch((error) => window.dispatchEvent(new CustomEvent("markdown-toast", {
              detail: { type: "error", message: error instanceof Error ? error.message : String(error) },
            })))
            .finally(() => setConvertingStorage(false));
        }}
      >{convertingStorage ? "切替中…" : storage === "embedded" ? "外部ファイルへ切替" : "埋め込みへ切替"}</button>}
    </div>
    <div className="drawio-block__preview">{preview}</div>
    {editing && !(load instanceof Error) && <DrawioEditorModal source={source} onSave={onSave!} onCancel={() => setEditing(false)} />}
  </div>;
}
