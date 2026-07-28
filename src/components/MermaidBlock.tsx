import { useEffect, useId, useState } from "react";
import { renderMermaid } from "../lib/mermaidService";

interface MermaidBlockProps { source: string; theme: string; mode: "on" | "off" | "error-code" | "always-code"; }

export function MermaidBlock({ source, theme, mode }: MermaidBlockProps) {
  const [state, setState] = useState<{ svg: string | null; error: string | null }>({ svg: null, error: null });
  const [showDetails, setShowDetails] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const id = useId().replace(/:/g, "-");
  useEffect(() => {
    let cancelled = false;
    if (mode === "off" || mode === "always-code") return;
    if (source.length > 500_000) { setState({ svg: null, error: "Mermaid source is too large to render." }); return; }
    setState({ svg: null, error: null });
    void renderMermaid(source, `mermaid-${id}`, theme)
      .then((svg) => { if (!cancelled) setState({ svg, error: null }); })
      .catch((error) => { if (!cancelled) setState({ svg: null, error: String(error) }); });
    return () => { cancelled = true; };
  }, [source, theme, id, mode]);

  if (mode === "off" || mode === "always-code") return <pre className="mermaid-source"><code>{source}</code></pre>;
  if (state.error) return <div className="mermaid-error"><strong>Mermaid を描画できません。</strong><div><button type="button" onClick={() => setShowDetails((value) => !value)}>エラー詳細</button><button type="button" onClick={() => setShowDetails(true)}>コードを表示</button></div>{showDetails && <><pre>{state.error}</pre><pre className="mermaid-source"><code>{source}</code></pre></>}</div>;
  if (!state.svg) return <div className="mermaid-loading">Rendering Mermaid…</div>;
  return <><button type="button" className="mermaid-block" aria-label="図を拡大" onClick={() => setZoomed(true)} dangerouslySetInnerHTML={{ __html: state.svg }} />{zoomed && <div className="mermaid-modal" role="dialog" aria-modal="true" onClick={() => setZoomed(false)}><div onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => setZoomed(false)}>閉じる</button><div dangerouslySetInnerHTML={{ __html: state.svg }} /></div></div>}</>;
}
