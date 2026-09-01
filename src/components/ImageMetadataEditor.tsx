import { useEffect, useState } from "react";
import { getFileName } from "../lib/path";
import type { ImageEditContext } from "./MediaPreviewModal";

export function ImageMetadataEditor({
  context,
  onSaveCaption,
  onRename,
}: {
  context: ImageEditContext;
  onSaveCaption: (context: ImageEditContext, caption: string) => Promise<void>;
  onRename?: (context: ImageEditContext, filename: string) => Promise<void>;
}) {
  const [caption, setCaption] = useState(context.caption);
  const [filename, setFilename] = useState(() => getFileName(context.imagePath));
  const [saving, setSaving] = useState<"caption" | "filename" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCaption(context.caption);
    setFilename(getFileName(context.imagePath));
    setError(null);
  }, [context]);

  const saveCaption = async () => {
    setSaving("caption");
    setError(null);
    try {
      await onSaveCaption(context, caption);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(null);
    }
  };
  const rename = async () => {
    if (!onRename) return;
    const trimmed = filename.trim();
    if (!trimmed || /[\\/:*?"<>|]/.test(trimmed)) {
      setError("ファイル名にはフォルダーや使用できない記号を含められません。");
      return;
    }
    setSaving("filename");
    setError(null);
    try {
      await onRename(context, trimmed);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(null);
    }
  };

  return <section className="image-metadata-editor" aria-label="画像情報の編集">
    <label>キャプション
      <input value={caption} onChange={(event) => setCaption(event.target.value)} />
    </label>
    <button type="button" disabled={saving !== null || caption === context.caption} onClick={() => void saveCaption()}>
      {saving === "caption" ? "保存中…" : "キャプションを保存"}
    </button>
    {onRename && <>
      <label>ファイル名
        <input value={filename} onChange={(event) => setFilename(event.target.value)} />
      </label>
      <button type="button" disabled={saving !== null || filename.trim() === getFileName(context.imagePath)} onClick={() => void rename()}>
        {saving === "filename" ? "変更中…" : "名前を変更"}
      </button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
