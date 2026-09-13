import { useEffect, useState } from "react";
import { DrawioBlock } from "../../components/DrawioBlock";
import { MermaidBlock } from "../../components/MermaidBlock";
import { sanitizeSvgXml } from "../../lib/svgSafety";
import { prepareDrawioLoad } from "../../lib/drawio";
import type { CodexDiagramKind } from "./diagram";

/** 編集中の構文エラーは直ちに表示し、直前に成功した図を変更後と誤認させない。 */
export function DiagramProposalPreview({ kind, source, theme }: { kind: CodexDiagramKind; source: string; theme: string }) {
  const [mermaidState, setMermaidState] = useState<{ source: string; error: string }>();
  useEffect(() => {
    if (kind !== "mermaid") return;
    let cancelled = false;
    void import("mermaid").then(({ default: mermaid }) => mermaid.parse(source))
      .then(() => { if (!cancelled) setMermaidState({ source, error: "" }); })
      .catch(error => { if (!cancelled) setMermaidState({ source, error: String(error) }); });
    return () => { cancelled = true; };
  }, [kind, source]);
  try {
    if (kind === "svg") return <div className="codex-diagram-preview" aria-label="SVG変更案" dangerouslySetInnerHTML={{ __html: sanitizeSvgXml(source) }} />;
    if (kind === "drawio") {
      prepareDrawioLoad(source);
      return <div className="codex-diagram-preview" aria-label="draw.io変更案"><DrawioBlock source={source} theme={theme} blockId="codex-proposal" /></div>;
    }
    if (mermaidState?.source !== source) return <p role="status">図を更新しています…</p>;
    if (mermaidState.error) throw new Error(mermaidState.error);
    return <div className="codex-diagram-preview" aria-label="Mermaid変更案"><MermaidBlock source={source} theme={theme} mode="on" showToolbar={false} /></div>;
  } catch (error) {
    return <div className="codex-diagram-preview" role="alert">図を表示できません。コードを修正してください。<pre>{String(error)}</pre></div>;
  }
}
