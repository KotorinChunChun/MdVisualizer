import { useMemo, useState } from "react";
import type { SharePointAssetEditContext } from "../hooks/useCropEditor";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { sanitizeSvgXml } from "../lib/svgSafety";
import "../styles/svg-source-editor.css";

export type SvgSourceEditTarget = SharePointAssetEditContext & {
  filename: string;
  svg: string;
};

export function SvgSourceEditor({
  target,
  onSave,
  onCancel,
}: {
  target: SvgSourceEditTarget;
  onSave: (svg: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [source, setSource] = useState(target.svg);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const modalRef = useFocusTrap<HTMLDivElement>(true, onCancel);
  const parsed = useMemo(() => {
    try {
      return { svg: sanitizeSvgXml(source), error: null };
    } catch (error) {
      return { svg: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [source]);

  const save = async () => {
    if (!parsed.svg || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(parsed.svg);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return <div ref={modalRef} className="svg-source-editor" role="dialog" aria-modal="true" tabIndex={-1} aria-label={`SVG編集: ${target.filename}`}>
    <header className="svg-source-editor__header">
      <strong>SVG編集: {target.filename}</strong>
      <div>
        <button type="button" disabled={saving || !parsed.svg || source === target.svg} onClick={() => void save()}>{saving ? "保存中…" : "SharePointへ保存"}</button>
        <button type="button" disabled={saving} onClick={onCancel}>閉じる</button>
      </div>
    </header>
    <div className="svg-source-editor__body">
      <label>
        <span>SVG XML</span>
        <textarea value={source} spellCheck={false} onChange={(event) => setSource(event.target.value)} />
      </label>
      <section aria-label="SVGプレビュー">
        {parsed.svg
          ? <div className="svg-source-editor__preview" dangerouslySetInnerHTML={{ __html: parsed.svg }} />
          : <p role="alert">{parsed.error}</p>}
      </section>
    </div>
    {saveError && <p className="svg-source-editor__error" role="alert">{saveError}</p>}
  </div>;
}
