import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openContainingFolder } from "../lib/commands";
import { externalFilename, splitExternalFilename, validateExternalFilename } from "../lib/externalFile";
import { useBrowserCapabilities } from "./BrowserCapabilities";

export function ExternalFileHeader({ source, path, kind, status, onRename, onError }: {
  source: string;
  path?: string | null;
  kind?: string;
  status?: "未保存" | "更新あり";
  onRename?: (filename: string) => Promise<boolean | void> | boolean | void;
  onError?: (message: string) => void;
}) {
  const capabilities = useBrowserCapabilities();
  const filename = externalFilename(source, path);
  const { stem, extension } = splitExternalFilename(filename);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stem);
  const [showPath, setShowPath] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (!editing) setDraft(stem); }, [editing, stem]);
  useEffect(() => {
    if (!editing) return;
    const commitOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !editorRef.current?.contains(target)) void commit();
    };
    document.addEventListener("pointerdown", commitOutside, true);
    return () => document.removeEventListener("pointerdown", commitOutside, true);
  }, [editing, draft, stem, extension, onRename, busy]);
  useEffect(() => {
    if (!menuPosition) return;
    const dismiss = () => setMenuPosition(null);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuPosition]);

  const commit = async () => {
    const nextStem = draft.trim();
    const validation = validateExternalFilename(draft);
    if (validation) { onError?.(validation); return; }
    if (nextStem === stem) { setEditing(false); return; }
    if (!onRename) return;
    setBusy(true);
    try {
      const result = await onRename(`${nextStem}${extension}`);
      if (result !== false) setEditing(false);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const filenameNode = editing ? <span ref={editorRef} className="external-file-header__editor">
    <input
      aria-label="外部ファイル名（拡張子を除く）"
      value={draft}
      disabled={busy}
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); void commit(); }
        if (event.key === "Escape") { setDraft(stem); setEditing(false); }
      }}
    />
    {extension && <span className="external-file-header__extension">{extension}</span>}
    <button type="button" disabled={busy} onClick={() => void commit()}>変更</button>
    <button type="button" disabled={busy} onClick={() => { setDraft(stem); setEditing(false); }}>取消</button>
  </span> : onRename ? <button
    type="button"
    className="external-file-header__filename"
    title={`${filename}（右クリックでファイル操作）`}
    onClick={() => setEditing(true)}
    onContextMenu={(event) => {
      if (!path) return;
      event.preventDefault();
      event.stopPropagation();
      setMenuPosition({ left: event.clientX, top: event.clientY });
    }}
  >{filename}</button> : <span className="external-file-header__filename" title={filename}>{filename}</span>;

  return <span className="external-file-header">
    {kind && <strong className="external-file-header__kind">{kind}</strong>}
    {filenameNode}
    {status && <span className={`external-file-header__status is-${status}`}>{status}</span>}
    {showPath && path && <span className="external-file-header__path" title={path}>{path}</span>}
    {menuPosition && path && createPortal(<div
      className="external-file-header__menu"
      role="menu"
      aria-label={`${filename}のファイル操作`}
      style={menuPosition}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={() => { setShowPath(true); setMenuPosition(null); }}>保存場所を表示</button>
      {capabilities.canOpenContainingFolder && <button type="button" role="menuitem" onClick={() => {
        setMenuPosition(null);
        void openContainingFolder(path).catch((error) => onError?.(String(error)));
      }}>フォルダーを開く</button>}
      <button type="button" role="menuitem" onClick={() => {
        setMenuPosition(null);
        void navigator.clipboard.writeText(path).catch((error) => onError?.(String(error)));
      }}>パスをコピー</button>
    </div>, document.body)}
  </span>;
}
