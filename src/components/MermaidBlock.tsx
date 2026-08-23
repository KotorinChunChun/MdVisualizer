import { useEffect, useId, useRef, useState } from "react";
import { mermaidInputError, mermaidRenderId, renderMermaid } from "../lib/mermaidService";
import { removeMermaidBlockStatus, setMermaidBlockStatus } from "../lib/mermaidStatus";
import type { MediaPreviewTarget } from "./MediaPreviewModal";
import { MermaidToolbar } from "./MermaidToolbar";

interface MermaidBlockProps {
  source: string;
  theme: string;
  mode: "on" | "off" | "error-code" | "always-code";
  /** Optional host identities supplied by a multi-window/tab integration. */
  windowId?: string;
  tabId?: string;
  blockId?: string;
  diagramIndex?: number;
  diagramCount?: number;
  onMediaOpen?: (target: MediaPreviewTarget) => void;
  showToolbar?: boolean;
  onRenderedSvg?: (svg: string | undefined) => void;
  /** Original source shown by the shared popup when a local translator is used. */
  mediaSource?: string;
  diagramAlt?: string;
}

type RenderState = { svg: string | null; error: string | null; pending: boolean };

export function MermaidBlock({
  source,
  theme,
  mode,
  windowId,
  tabId,
  blockId,
  diagramIndex,
  diagramCount,
  onMediaOpen,
  showToolbar = true,
  onRenderedSvg,
  mediaSource,
  diagramAlt = "Mermaid図",
}: MermaidBlockProps) {
  const [state, setState] = useState<RenderState>({ svg: null, error: null, pending: false });
  const [showDetails, setShowDetails] = useState(false);
  const [visible, setVisible] = useState(false);
  const [display, setDisplay] = useState<"diagram" | "code">("diagram");
  const hostRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);
  const localId = useId().replace(/:/g, "-");
  const stableBlockId = blockId ?? localId;
  const statusId = mermaidRenderId({ windowId, tabId, blockId: stableBlockId });

  useEffect(() => () => removeMermaidBlockStatus(statusId), [statusId]);

  useEffect(() => {
    onRenderedSvg?.(state.svg ?? undefined);
  }, [onRenderedSvg, state.svg]);

  useEffect(() => {
    const element = hostRef.current;
    if (!element || mode === "off" || mode === "always-code") return;
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    setVisible(false);
    const observer = new window.IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "320px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode, source, theme, statusId]);

  useEffect(() => {
    if (mode === "off" || mode === "always-code") {
      setState({ svg: null, error: null, pending: false });
      removeMermaidBlockStatus(statusId);
      return;
    }
    if (!visible) return;

    const generation = ++generationRef.current;
    const renderId = mermaidRenderId({ windowId, tabId, blockId: stableBlockId, generation }, `mermaid-${localId}`);
    const inputError = mermaidInputError(source, { diagramIndex, diagramCount });
    if (inputError) {
      setState({ svg: null, error: inputError, pending: false });
      setMermaidBlockStatus(statusId, { state: "error", error: inputError });
      return;
    }

    setShowDetails(false);
    setState({ svg: null, error: null, pending: true });
    setMermaidBlockStatus(statusId, { state: "pending" });
    let disposed = false;
    void renderMermaid(source, renderId, theme, { windowId, tabId, blockId: stableBlockId, generation, diagramIndex, diagramCount })
      .then((svg) => {
        if (disposed || generation !== generationRef.current) return;
        setState({ svg, error: null, pending: false });
        setMermaidBlockStatus(statusId, { state: "rendered" });
      })
      .catch((error: unknown) => {
        if (disposed || generation !== generationRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        setState({ svg: null, error: message, pending: false });
        setMermaidBlockStatus(statusId, { state: "error", error: message });
      });
    return () => { disposed = true; };
  }, [diagramCount, diagramIndex, localId, mode, source, stableBlockId, statusId, tabId, theme, visible, windowId]);

  if (mode === "off" || mode === "always-code") return <div className="mermaid-container">
    {showToolbar && <MermaidToolbar source={source} display="code" />}
    <pre className="mermaid-source"><code>{source}</code></pre>
  </div>;
  const shouldShowCode = mode === "error-code" && state.error !== null;
  const displayedContent = shouldShowCode ? "code" : display;
  return <div ref={hostRef} className="mermaid-container">
    {showToolbar && <MermaidToolbar source={source} svg={state.svg ?? undefined} display={displayedContent} onDisplayChange={setDisplay} />}
    {state.error && <div className="mermaid-error"><strong>Mermaid を描画できません。</strong><div><button type="button" onClick={() => setShowDetails((value) => !value)}>エラー詳細</button>{displayedContent !== "code" && <button type="button" onClick={() => setDisplay("code")}>コードを表示</button>}</div>{showDetails && <pre>{state.error}</pre>}</div>}
    {displayedContent === "code" && <pre className="mermaid-source"><code>{source}</code></pre>}
    {displayedContent === "diagram" && !state.error && state.pending && <div className="mermaid-loading">Rendering Mermaid…</div>}
    {displayedContent === "diagram" && !state.error && !state.pending && !state.svg && <div className="mermaid-loading">Mermaid を表示する準備中です…</div>}
    {displayedContent === "diagram" && state.svg && <button type="button" className="mermaid-block" aria-label="図を拡大" onClick={() => onMediaOpen?.({ content: { kind: "svg", svg: state.svg!, alt: diagramAlt }, mermaidSource: mediaSource ?? source })} dangerouslySetInnerHTML={{ __html: state.svg }} />}
  </div>;
}
