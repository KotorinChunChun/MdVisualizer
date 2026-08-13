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
  ariaLabel = "Mermaid操作",
  allowFileCopy = true,
  onEdit,
}: {
  source: string;
  svg?: string;
  display: "diagram" | "code";
  onDisplayChange?: (display: "diagram" | "code") => void;
  ariaLabel?: string;
  allowFileCopy?: boolean;
  onEdit?: () => void;
}) {
  const copy = async (event: MouseEvent<HTMLButtonElement>, kind: MermaidCopyKind) => {
    const button = event.currentTarget;
    try {
      await copyMermaid(kind, source, svg ?? "");
      const message = kind === "code" ? "コードをコピーしました" : `${kind.toUpperCase()}で図をコピーしました`;
      const copyAsFile = allowFileCopy ? async () => {
        try {
          await copyMermaidAsFile(kind, source, svg ?? "");
          emitToast("success", "ファイルをクリップボードにコピーしました");
        } catch {
          emitToast("error", "ファイルとしてコピーできませんでした");
        }
      } : undefined;
      emitToast("success", message, copyAsFile);
    } catch {
      emitToast("error", kind === "code" ? "コードをコピーできませんでした" : "図をコピーできませんでした");
    } finally {
      button.blur();
    }
  };

  return <div className="mermaid-toolbar" role="toolbar" aria-label={ariaLabel}>
    <div className="mermaid-toolbar__copy" role="group" aria-label="コピー">
      <button className="diagram-action-button" type="button" onClick={(event) => void copy(event, "code")}>コードをコピー</button>
      {svg && <button className="diagram-action-button" type="button" onClick={(event) => void copy(event, "png")}>PNGをコピー</button>}
      {svg && <button className="diagram-action-button" type="button" onClick={(event) => void copy(event, "svg")}>SVGをコピー</button>}
    </div>
    {onDisplayChange && <div className="mermaid-toolbar__view" role="group" aria-label="表示内容">
      <button className="diagram-action-button" type="button" disabled={!svg} aria-pressed={display === "diagram"} onClick={() => onDisplayChange("diagram")}>プレビュー</button>
      <button className="diagram-action-button" type="button" aria-pressed={display === "code"} onClick={() => onDisplayChange("code")}>コード</button>
    </div>}
    {onEdit && <button className="diagram-action-button" type="button" onClick={onEdit}>編集</button>}
  </div>;
}
