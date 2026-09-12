import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { classifyDrawioSource, prepareDrawioLoad } from "../lib/drawio";
import { copyMermaid, normalizeSvgForClipboard } from "../lib/mermaidClipboard";
import { sanitizeSvgXml } from "../lib/svgSafety";
import { MermaidBlock } from "./MermaidBlock";
import { MermaidToolbar } from "./MermaidToolbar";
import { DrawioEditorModal } from "./DrawioEditorModal";
import { ResponsiveToolbar } from "./ResponsiveToolbar";
import type { MediaPreviewTarget } from "./MediaPreviewModal";
import "../styles/drawio.css";
import { DiagramCodexDialog } from "../features/codex/DiagramCodexAction";
import { createPortal } from "react-dom";

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
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}.mxgraph{width:100%;height:100%;min-height:0}</style></head><body><div class="mxgraph" data-mxgraph="${config}"></div><script>(()=>{const send=()=>{const svg=document.querySelector('svg');if(svg)parent.postMessage({type:'mdvisualizer-drawio-svg',svg:svg.outerHTML},'*')};window.captureDrawioSvg=send;window.reportDrawioViewerError=()=>parent.postMessage({type:'mdvisualizer-drawio-error'},'*');new MutationObserver(send).observe(document.body,{subtree:true,childList:true,attributes:true})})()</script><script src="https://viewer.diagrams.net/js/viewer-static.min.js" referrerpolicy="no-referrer" onload="try{GraphViewer.processElements();captureDrawioSvg()}catch(e){window.reportDrawioViewerError()}" onerror="window.reportDrawioViewerError()"></script></body></html>`;
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

function copyDiagramBmp(event: MouseEvent, source: string, svg: string): void {
  event.preventDefault();
  event.stopPropagation();
  void copyMermaid("bmp", source, svg).then(() => {
    window.dispatchEvent(new CustomEvent("markdown-toast", { detail: { type: "success", message: "BMP画像をコピーしました" } }));
  }).catch((error) => {
    window.dispatchEvent(new CustomEvent("markdown-toast", { detail: { type: "error", message: error instanceof Error ? error.message : "図をコピーできませんでした" } }));
  });
}

export function fitDrawioSvgToContent(svg: SVGSVGElement, padding = 20): string {
  const fitted = svg.cloneNode(true) as SVGSVGElement;
  const existingViewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const hasUsableViewBox = existingViewBox?.length === 4
    && existingViewBox.every(Number.isFinite)
    && existingViewBox[2] > 0
    && existingViewBox[3] > 0;
  const hasDrawableContent = Boolean(svg.querySelector("path,rect,circle,ellipse,line,polyline,polygon,text,image,foreignObject,use"));
  if (hasUsableViewBox && hasDrawableContent) {
    fitted.setAttribute("viewBox", [
      existingViewBox[0] - padding,
      existingViewBox[1] - padding,
      existingViewBox[2] + padding * 2,
      existingViewBox[3] + padding * 2,
    ].join(" "));
  } else if (!hasUsableViewBox) {
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

export function isEmptyDrawioSource(source: string): boolean {
  const kind = classifyDrawioSource(source);
  if (kind === "empty") return true;
  if (kind !== "xml") return false;
  const parsed = new DOMParser().parseFromString(source, "application/xml");
  if (parsed.querySelector("parsererror")) return false;
  if (parsed.querySelector('mxCell[vertex="1"],mxCell[edge="1"]')) return false;
  const diagrams = [...parsed.querySelectorAll("diagram")];
  if (diagrams.some((diagram) => diagram.children.length === 0 && diagram.textContent?.trim())) return false;
  return Boolean(parsed.querySelector("mxGraphModel, mxfile"));
}

export function DrawioBlock({ source, theme, blockId, headingTitle, headingLabel, description, storage, onStorageConvert, onSave, onMediaOpen }: {
  source: string;
  theme: string;
  blockId: string;
  headingTitle?: string;
  headingLabel?: ReactNode;
  description?: string;
  storage?: "embedded" | "external";
  onStorageConvert?: () => boolean | void | Promise<boolean | void>;
  onSave?: (source: string) => boolean | void | Promise<boolean | void>;
  onMediaOpen?: (target: MediaPreviewTarget) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [codexOpen, setCodexOpen] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [renderedSvg, setRenderedSvg] = useState<string>();
  const [viewerHeight, setViewerHeight] = useState(180);
  const [viewerAttempt, setViewerAttempt] = useState(0);
  const [display, setDisplay] = useState<"diagram" | "code">("diagram");
  const [convertingStorage, setConvertingStorage] = useState(false);
  const viewerRef = useRef<HTMLIFrameElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const kind = useMemo(() => classifyDrawioSource(source), [source]);
  const emptyDiagram = useMemo(() => isEmptyDrawioSource(source), [source]);
  const load = useMemo(() => {
    try { return prepareDrawioLoad(source); }
    catch (error) { return error instanceof Error ? error : new Error(String(error)); }
  }, [source]);
  const safeSourceSvg = useMemo(() => {
    if (kind !== "svg") return undefined;
    try {
      const sanitized = sanitizeSvgXml(source);
      const parsed = new DOMParser().parseFromString(sanitized, "image/svg+xml");
      const svg = parsed.documentElement;
      return parsed.querySelector("parsererror") || svg.localName !== "svg"
        ? undefined
        : fitDrawioSvgToContent(svg as unknown as SVGSVGElement);
    }
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
    setViewerHeight(emptyDiagram ? 100 : 180);
    setViewerAttempt(0);
  }, [emptyDiagram, safeSourceSvg, source]);

  useEffect(() => {
    if (display !== "diagram" || !viewerDocument) return;
    const frame = viewerRef.current;
    if (!frame) return;
    let timeout = 0;
    const failOrRetry = () => {
      window.clearTimeout(timeout);
      if (viewerAttempt < 1) {
        setViewerError(null);
        setViewerAttempt(viewerAttempt + 1);
      } else {
        setViewerError("draw.ioビューアーを読み込めませんでした。");
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.type === "mdvisualizer-drawio-error") {
        failOrRetry();
        return;
      }
      if (event.data?.type !== "mdvisualizer-drawio-svg" || typeof event.data.svg !== "string") return;
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
    timeout = window.setTimeout(failOrRetry, 12_000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timeout);
    };
  }, [display, viewerAttempt, viewerDocument]);

  useEffect(() => {
    if (display !== "diagram" || !viewerDocument || !renderedSvg) return;
    const host = previewRef.current;
    if (!host) return;
    const updateHeight = () => {
      if (emptyDiagram) {
        setViewerHeight(100);
        return;
      }
      const style = getComputedStyle(host);
      const horizontalPadding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      const width = Math.max(0, host.clientWidth - horizontalPadding);
      const height = drawioPreviewHeight(renderedSvg, width);
      if (height !== null) setViewerHeight((current) => current === height ? current : height);
    };
    updateHeight();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateHeight);
    observer?.observe(host);
    window.addEventListener("resize", updateHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [display, emptyDiagram, renderedSvg, viewerDocument]);

  const label = kind === "svg" ? "SVG → draw.io" : kind === "mermaid" ? "Mermaid → draw.io" : kind === "compressed" ? "draw.io（圧縮データ）" : "draw.io";
  const toolbarLabel = `${label}${headingTitle?.trim() ? ` — ${headingTitle.trim()}` : ""}`;
  const svgPreview = (svg: string, alt: string, height?: number) => {
    const content = <div className="drawio-block__svg" style={height ? { height } : undefined} dangerouslySetInnerHTML={{ __html: svg }} />;
    return onMediaOpen
      ? <button
        type="button"
        className="drawio-block__zoom"
        aria-label="図を拡大"
        onClick={() => onMediaOpen({ content: { kind: "svg", svg, alt }, headingTitle: headingTitle ?? alt, diagramSource: source, diagramKind: "drawio" })}
        onContextMenu={(event) => copyDiagramBmp(event, source, svg)}
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
  else if (renderedSvg) preview = svgPreview(renderedSvg, "draw.io図", viewerHeight);
  else {
    const viewerHost = <iframe
      ref={viewerRef}
      key={viewerAttempt}
      className="drawio-block__viewer-frame"
      title="draw.ioプレビュー"
      srcDoc={viewerDocument}
      style={{ height: emptyDiagram ? 100 : 180 }}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
    />;
    preview = onMediaOpen
      ? <button
        type="button"
        className="drawio-block__zoom"
        aria-label="図を拡大"
        aria-disabled={!renderedSvg}
        onClick={() => renderedSvg && onMediaOpen({ content: { kind: "svg", svg: renderedSvg, alt: "draw.io図" }, headingTitle: headingTitle ?? "draw.io図", diagramSource: source, diagramKind: "drawio" })}
        onContextMenu={(event) => renderedSvg && copyDiagramBmp(event, source, renderedSvg)}
      >{viewerHost}</button>
      : viewerHost;
  }

  return <div className="drawio-block" data-drawio-block={blockId}>
    <ResponsiveToolbar threeStage className="drawio-block__toolbar diagram-block__header" ariaLabel="draw.ioブロック操作" label={headingLabel ?? <span>{toolbarLabel}{storage && <span className="content-storage-status">{storage === "embedded" ? "埋め込み" : "外部参照"}</span>}</span>} items={[
      ...(onSave ? [{ id: "edit", group: "edit", priority: 80, node: <button className="diagram-action-button" type="button" onClick={() => setEditing(true)}>編集</button> }] : []),
      ...(onSave ? [{ id: "codex", group: "edit", priority: 75, node: <button type="button" className="diagram-action-button" onClick={() => setCodexOpen(true)}>Codexに図を依頼</button> }] : []),
      { id: "copy-view", group: "copy", priority: 100, compactNode: <MermaidToolbar compact source={source} svg={renderedSvg} display={display} onDisplayChange={setDisplay} previewDisabled={false} ariaLabel="draw.io操作" fileDiagramKind="drawio" />, node: <MermaidToolbar
        source={source}
        svg={renderedSvg}
        display={display}
        onDisplayChange={setDisplay}
        previewDisabled={false}
        ariaLabel="draw.io操作"
        fileDiagramKind="drawio"
      /> },
      ...(storage && onStorageConvert ? [{ id: "storage", group: "storage", priority: 10, node: <button
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
      >{convertingStorage ? "切替中…" : storage === "embedded" ? "外部ファイルへ切替" : "埋め込みへ切替"}</button> }] : []),
    ]} />
    <div className="drawio-block__preview" ref={previewRef}>{preview}</div>
    {description?.trim() && <div className="diagram-alt">{description.trim()}</div>}
    {editing && !(load instanceof Error) && <DrawioEditorModal source={source} onSave={onSave!} onCancel={() => setEditing(false)} />}
    {codexOpen && onSave && createPortal(<DiagramCodexDialog kind={kind === "svg" ? "svg" : "drawio"} source={source} onSave={onSave} label={headingTitle ?? label} theme={theme} onClose={() => setCodexOpen(false)} />, document.body)}
  </div>;
}
