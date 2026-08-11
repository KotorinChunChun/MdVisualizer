import { useEffect, useMemo, useRef, useState } from "react";
import { classifyDrawioSource, prepareDrawioLoad } from "../lib/drawio";
import { sanitizeSvgXml } from "../lib/svgSafety";
import { MermaidBlock } from "./MermaidBlock";
import { DrawioEditorModal } from "./DrawioEditorModal";
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

export function DrawioBlock({ source, theme, blockId, onSave }: {
  source: string;
  theme: string;
  blockId: string;
  onSave?: (source: string) => boolean | void;
}) {
  const [editing, setEditing] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const kind = useMemo(() => classifyDrawioSource(source), [source]);
  const load = useMemo(() => {
    try { return prepareDrawioLoad(source); }
    catch (error) { return error instanceof Error ? error : new Error(String(error)); }
  }, [source]);

  useEffect(() => {
    if (load instanceof Error || "descriptor" in load || kind === "svg") return;
    const element = viewerRef.current;
    if (!element) return;
    element.setAttribute("data-mxgraph", JSON.stringify({ highlight: "#0000ff", nav: true, resize: true, toolbar: "zoom layers lightbox", xml: load.xml }));
    let disposed = false;
    void ensureDrawioViewer().then(() => {
      if (!disposed) window.GraphViewer?.processElements();
    }).catch((error) => { if (!disposed) setViewerError(String(error)); });
    return () => { disposed = true; };
  }, [kind, load]);

  const label = kind === "svg" ? "SVG → draw.io" : kind === "mermaid" ? "Mermaid → draw.io" : kind === "compressed" ? "draw.io（圧縮データ）" : "draw.io";
  let preview;
  if (load instanceof Error) preview = <p className="drawio-block__error">{load.message}</p>;
  else if (kind === "svg") {
    try { preview = <div className="drawio-block__svg" dangerouslySetInnerHTML={{ __html: sanitizeSvgXml(source) }} />; }
    catch { preview = <p className="drawio-block__error">SVGを安全に表示できません。</p>; }
  } else if (kind === "mermaid") preview = <MermaidBlock source={source} theme={theme} mode="on" blockId={`drawio-${blockId}`} diagramIndex={0} diagramCount={1} />;
  else preview = viewerError
    ? <div className="drawio-block__fallback"><p>{viewerError}</p><pre><code>{source}</code></pre></div>
    : <div ref={viewerRef} className="drawio-block__viewer mxgraph" />;

  return <div className="drawio-block" data-drawio-block={blockId}>
    <div className="drawio-block__toolbar">
      <span>{label}</span>
      {onSave && <button type="button" onClick={() => setEditing(true)}>編集</button>}
    </div>
    <div className="drawio-block__preview">{preview}</div>
    {editing && !(load instanceof Error) && <DrawioEditorModal source={source} onSave={onSave!} onCancel={() => setEditing(false)} />}
  </div>;
}
