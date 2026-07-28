import { useEffect, useId, useState } from "react";
import { renderMermaid } from "../lib/mermaidService";

interface MermaidBlockProps { source: string; theme: string; }

export function MermaidBlock({ source, theme }: MermaidBlockProps) {
  const [state, setState] = useState<{ svg: string | null; error: string | null }>({ svg: null, error: null });
  const id = useId().replace(/:/g, "-");
  useEffect(() => {
    let cancelled = false;
    if (source.length > 500_000) { setState({ svg: null, error: "Mermaid source is too large to render." }); return; }
    setState({ svg: null, error: null });
    void renderMermaid(source, `mermaid-${id}`, theme)
      .then((svg) => { if (!cancelled) setState({ svg, error: null }); })
      .catch((error) => { if (!cancelled) setState({ svg: null, error: String(error) }); });
    return () => { cancelled = true; };
  }, [source, theme, id]);

  if (state.error) return <pre className="mermaid-error">Mermaid error: {state.error}</pre>;
  if (!state.svg) return <div className="mermaid-loading">Rendering Mermaid…</div>;
  return <div className="mermaid-block" dangerouslySetInnerHTML={{ __html: state.svg }} />;
}
