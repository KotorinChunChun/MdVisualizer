import { BlockCopyMenu } from "./BlockCopyMenu";
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
  fileDiagramKind = "mermaid",
  previewDisabled,
  onEdit,
  compact = false,
}: {
  source: string;
  svg?: string;
  display: "diagram" | "code";
  onDisplayChange?: (display: "diagram" | "code") => void;
  ariaLabel?: string;
  allowFileCopy?: boolean;
  fileDiagramKind?: "mermaid" | "drawio";
  previewDisabled?: boolean;
  onEdit?: () => void;
  compact?: boolean;
}) {
  const copy = async (event: MouseEvent<HTMLButtonElement>, kind: MermaidCopyKind) => {
    const button = event.currentTarget;
    try {
      await copyMermaid(kind, source, svg ?? "");
      const message = kind === "code"
        ? "コードをコピーしました"
        : kind === "png" ? "PNG画像をコピーしました" : kind === "bmp" ? "BMP画像をコピーしました" : "ベクタ画像をコピーしました";
      const copyAsFile = allowFileCopy ? async () => {
        try {
          await copyMermaidAsFile(kind, source, svg ?? "", fileDiagramKind);
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
    <div className="mermaid-toolbar__copy" data-group="copy" role="group" aria-label="コピー">
      {compact ? <BlockCopyMenu>
        <button type="button" onClick={(event) => void copy(event, "code")}>コードをコピー</button>
        {svg && <><button type="button" onClick={(event) => void copy(event, "bmp")}>BMPコピー</button><button type="button" onClick={(event) => void copy(event, "svg")}>ベクタコピー</button></>}
      </BlockCopyMenu> : <>
      <button className="diagram-action-button" type="button" onClick={(event) => void copy(event, "code")}>コードをコピー</button>
      {svg && <button className="diagram-action-button" type="button" onClick={(event) => void copy(event, "bmp")}>BMPコピー</button>}
      {svg && <button className="diagram-action-button" type="button" onClick={(event) => void copy(event, "svg")}>ベクタコピー</button>}
      </>}
    </div>
    {onDisplayChange && <div className="mermaid-toolbar__view" data-group="view" role="group" aria-label="表示内容">
      {compact ? <select aria-label="表示内容" value={display} onChange={(event) => onDisplayChange(event.target.value as "diagram" | "code")}><option value="diagram" disabled={previewDisabled ?? !svg}>プレビュー</option><option value="code">コード</option></select> : <><button className="diagram-action-button" type="button" disabled={previewDisabled ?? !svg} aria-pressed={display === "diagram"} onClick={() => onDisplayChange("diagram")}>プレビュー</button>
      <button className="diagram-action-button" type="button" aria-pressed={display === "code"} onClick={() => onDisplayChange("code")}>コード</button>
      </>}
    </div>}
    {onEdit && <div className="mermaid-toolbar__edit" data-group="edit"><button className="diagram-action-button" type="button" onClick={onEdit}>編集</button></div>}
  </div>;
}
