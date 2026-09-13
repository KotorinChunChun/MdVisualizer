import { useMemo, useState } from "react";
import { plantUmlToMermaid } from "@mdvisualizer/markdown-core";
import type { MediaPreviewTarget } from "./MediaPreviewModal";
import { MermaidBlock } from "./MermaidBlock";
import { ResponsiveToolbar } from "./ResponsiveToolbar";
import { MermaidToolbar } from "./MermaidToolbar";

export function PlantUmlBlock({
  source,
  theme,
  mode,
  windowId,
  tabId,
  blockId,
  onMediaOpen,
}: {
  source: string;
  theme: string;
  mode: "on" | "off" | "error-code" | "always-code";
  windowId?: string;
  tabId?: string;
  blockId: string;
  onMediaOpen?: (target: MediaPreviewTarget) => void;
}) {
  const [display, setDisplay] = useState<"diagram" | "code">("diagram");
  const conversion = useMemo(() => {
    try { return { value: plantUmlToMermaid(source), error: null }; }
    catch (error) { return { value: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [source]);
  const showCode = mode === "off" || mode === "always-code" || display === "code" || Boolean(conversion.error);

  return <div className="plantuml-container">
    <ResponsiveToolbar threeStage className="diagram-block__header" ariaLabel="PlantUML表示" label={<strong>PlantUML（ローカル）</strong>} items={[
      { id: "copy-view", node: <MermaidToolbar source={source} display={showCode ? "code" : "diagram"} onDisplayChange={setDisplay} previewDisabled={!conversion.value} allowFileCopy={false} />,
        compactNode: <MermaidToolbar compact source={source} display={showCode ? "code" : "diagram"} onDisplayChange={setDisplay} previewDisabled={!conversion.value} allowFileCopy={false} /> },
    ]} />
    {conversion.error && <div className="mermaid-error"><strong>PlantUMLを描画できません。</strong><pre>{conversion.error}</pre></div>}
    {showCode && <pre className="mermaid-source"><code>{source}</code></pre>}
    {!showCode && conversion.value && <MermaidBlock
      source={conversion.value.mermaid}
      theme={theme}
      mode={mode}
      windowId={windowId}
      tabId={tabId}
      blockId={blockId}
      onMediaOpen={onMediaOpen}
      showToolbar={false}
      mediaSource={source}
      diagramAlt="PlantUML図"
    />}
  </div>;
}
