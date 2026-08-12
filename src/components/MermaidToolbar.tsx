import type { MouseEvent } from "react";
import { copyMermaid, copyMermaidAsFile, type MermaidCopyKind } from "../lib/mermaidClipboard";

function emitToast(type: "success" | "error", message: string, copyAsFile?: () => Promise<void>): void {
  window.dispatchEvent(new CustomEvent("markdown-toast", { detail: { type, message, actionLabel: copyAsFile ? "ファイルとしてコピー" : undefined, onAction: copyAsFile } }));
}

export function MermaidToolbar({
  source,
  svg,
  display,
  onDisplayChange,
}: {
  source: string;
  svg?: string;
  display: "diagram" | "code";
  onDisplayChange?: (display: "diagram" | "code") => void;
}) {
  const copy = async (event: MouseEvent<HTMLButtonElement>, kind: MermaidCopyKind) => {
    const button = event.currentTarget;
    try {
      await copyMermaid(kind, source, svg ?? "");
      const message = kind === "code" ? "コードをコピーしました" : `${kind.toUpperCase()}で図をコピーしました`;
      emitToast("success", message, async () => {
        try {
          await copyMermaidAsFile(kind, source, svg ?? "");
          emitToast("success", "ファイルをクリップボードにコピーしました");
        } catch {
          emitToast("error", "ファイルとしてコピーできませんでした");
        }
      });
    } catch {
      emitToast("error", kind === "code" ? "コードをコピーできませんでした" : "図をコピーできませんでした");
    } finally {
      button.blur();
    }
  };

  return <div className="mermaid-toolbar" role="toolbar" aria-label="Mermaid操作">
    <div className="mermaid-toolbar__copy" role="group" aria-label="コピー">
      <button type="button" onClick={(event) => void copy(event, "code")}>コードをコピー</button>
      {svg && <button type="button" onClick={(event) => void copy(event, "png")}>PNGをコピー</button>}
      {svg && <button type="button" onClick={(event) => void copy(event, "svg")}>SVGをコピー</button>}
    </div>
    {onDisplayChange && <div className="mermaid-toolbar__view" role="group" aria-label="表示内容">
      <button type="button" disabled={!svg} aria-pressed={display === "diagram"} onClick={() => onDisplayChange("diagram")}>プレビュー</button>
      <button type="button" aria-pressed={display === "code"} onClick={() => onDisplayChange("code")}>コード</button>
    </div>}
  </div>;
}
