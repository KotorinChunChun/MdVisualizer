import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./codexImageEdit.css";

export type ImageSaveMode = "overwrite" | "new" | "archive";
export interface CodexImageEditResult { base64: string; mediaType: "image/png"; filename: string }

export function CodexImageEdit({ documentPath, source, originalBase64, initialInstruction = "", instruction: suppliedInstruction, onInstructionChange, onReferenceChange, onGenerated, onBusyChange, onRequestAuthorization, disabled = false, actionFooter }: {
  documentPath: string; source: string; originalBase64: string; initialInstruction?: string;
  onReferenceChange: (source: string, newSource: string) => boolean | Promise<boolean>;
  instruction?: string; onInstructionChange?: (value: string) => void;
  onGenerated?: (instruction: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onRequestAuthorization?: () => Promise<boolean>;
  disabled?: boolean;
  actionFooter?: ReactNode;
}) {
  const [localInstruction, setLocalInstruction] = useState("");
  const instruction = suppliedInstruction ?? localInstruction;
  const setInstruction = (value: string) => { setLocalInstruction(value); onInstructionChange?.(value); };
  const [result, setResult] = useState<CodexImageEditResult | null>(null);
  const [layout, setLayout] = useState<"horizontal" | "vertical">("horizontal");
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<ImageSaveMode>("new");
  const [filename, setFilename] = useState("codex-edited.png");
  const active = useRef<string | null>(null);
  const generation = useRef(0);
  const embedded = /^data:image\/png;base64,/i.test(source);
  const original = `data:image/png;base64,${originalBase64}`;
  useEffect(() => {
    generation.current++;
    setResult(null);
    return () => {
      generation.current++;
      const id = active.current;
      active.current = null;
      if (id) void invoke("codex_cancel_image", { id }).catch(() => {});
    };
  }, [source, originalBase64]);

  async function edit() {
    const token = generation.current;
    if (!instruction.trim() || busy || disabled || active.current) return;
    if (onRequestAuthorization && !await onRequestAuthorization()) return;
    // 同意ダイアログ中に対象画像が切り替わった場合、古い画像では実行しない。
    if (token !== generation.current || disabled || busy || active.current) return;
    const id = crypto.randomUUID();
    active.current = id;
    setBusy(true); setError("");
    try {
      const value = await invoke<CodexImageEditResult>("codex_edit_image", {
        request: { id, instruction: [initialInstruction, instruction].filter(Boolean).join("\n\n"), documentPath, source, image: { base64: originalBase64 } },
      });
      if (token === generation.current && active.current === id) {
        setResult(value); setFilename(value.filename);
        onGenerated?.(instruction);
      }
    } catch (cause) { if (token === generation.current) setError(String(cause)); }
    finally { if (active.current === id) { active.current = null; setBusy(false); } }
  }

  function stop() {
    const id = active.current;
    if (!id) return;
    active.current = null;
    generation.current++;
    setBusy(false);
    setSaving(false);
    void invoke("codex_cancel_image", { id }).catch(cause => setError(String(cause)));
  }

  function handleInstructionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!event.nativeEvent.isComposing && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void edit();
    }
  }

  async function save() {
    if (!result || busy) return;
    const token = generation.current;
    setBusy(true); setSaving(true); setError("");
    let rollbackId = "";
    try {
      if (embedded) {
        if (!await onReferenceChange(source, `data:image/png;base64,${result.base64}`)) throw new Error("文書が変わりました。画像を選択し直してください。");
      } else {
        const saved = await invoke<{ newSource: string; rollbackId: string }>("codex_save_edited_image", {
          request: { documentPath, source, expectedOriginalBase64: originalBase64, resultBase64: result.base64, mode, filename },
        });
        rollbackId = saved.rollbackId;
        if (token !== generation.current || !await onReferenceChange(source, saved.newSource)) throw new Error("文書の画像参照を確認できません。画像の保存を取り消します。");
        await invoke("codex_finalize_edited_image", { rollbackId, commit: true });
        rollbackId = "";
      }
      if (token === generation.current) setResult(null);
    } catch (cause) {
      let message = String(cause);
      if (rollbackId) {
        try { await invoke("codex_finalize_edited_image", { rollbackId, commit: false }); }
        catch (rollbackError) { message += `\n自動復旧に失敗しました: ${String(rollbackError)}`; }
      }
      if (token === generation.current) setError(message);
    } finally { if (token === generation.current) { setBusy(false); setSaving(false); } }
  }

  return <section className="codex-image-edit" aria-label="AIで画像を編集">
    <div className="codex-image-edit__prompt">
      <label>編集指示<textarea rows={7} value={instruction} disabled={busy || disabled} onChange={event => setInstruction(event.target.value)} onKeyDown={handleInstructionKeyDown} placeholder="例: 背景を白にして文字を読みやすくしてください" /></label>
      <div className="codex-image-edit__send-actions">
        <button type="button" aria-label="画像編集を依頼" disabled={disabled || busy || !instruction.trim()} onClick={() => void edit()}>{busy ? saving ? "保存中…" : "送信中…" : "送信"}<small>（Ctrl+Enter）</small></button>
        <button type="button" disabled={!busy || saving} onClick={stop}>停止</button>
        {actionFooter}
      </div>
    </div>
    {busy && <div className="codex-image-edit__sending" role="status"><span className="codex-image-edit__spinner" aria-hidden="true" />{saving ? "画像を保存中…" : "送信中・画像生成を待っています…"}</div>}
    {result && <>
      <div className="codex-image-edit__layout"><button type="button" aria-pressed={layout === "horizontal"} onClick={() => setLayout("horizontal")}>左右配置</button><button type="button" aria-pressed={layout === "vertical"} onClick={() => setLayout("vertical")}>上下配置</button></div>
      <div className={`codex-image-edit__comparison codex-image-edit__comparison--${layout}`}><figure><figcaption>変更前</figcaption><img src={original} alt="変更前の画像" /></figure><figure><figcaption>変更後</figcaption><img src={`data:image/png;base64,${result.base64}`} alt="変更後の画像" /></figure></div>
      {embedded ? <p>採用すると文書に埋め込まれた画像を差し替えます。</p> : <fieldset disabled={busy}>
        <legend>採用方法</legend>
        <label><input type="radio" checked={mode === "overwrite"} onChange={() => setMode("overwrite")} />元画像を上書き</label>
        <label><input type="radio" checked={mode === "new"} onChange={() => setMode("new")} />別名で保存して参照を更新</label>
        <label><input type="radio" checked={mode === "archive"} onChange={() => setMode("archive")} />元画像をarchiveへ残して同じファイル名で置換</label>
        {mode === "new" && <label>保存ファイル名<input value={filename} onChange={event => setFilename(event.target.value)} /></label>}
      </fieldset>}
      <button type="button" disabled={busy} onClick={() => void save()}>この画像を採用</button><button type="button" disabled={busy} onClick={() => setResult(null)}>却下</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
