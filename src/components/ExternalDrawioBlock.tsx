import { useEffect, useMemo, useState } from "react";
import { loadMarkdown, saveMarkdown } from "../lib/commands";
import { resolveLocalImagePath } from "../lib/path";
import type { MarkdownLoadResult } from "../types/app";
import type { MediaPreviewTarget } from "./MediaPreviewModal";
import { DrawioBlock } from "./DrawioBlock";

function emitToast(type: "success" | "error", message: string) {
  window.dispatchEvent(new CustomEvent("markdown-toast", { detail: { type, message } }));
}

export function ExternalDrawioBlock({
  source,
  alt,
  baseDir,
  theme,
  blockId,
  version,
  editable = true,
  stagedSource,
  onStorageConvert,
  onMediaOpen,
}: {
  source: string;
  alt?: string;
  baseDir: string;
  theme: string;
  blockId: string;
  version: number;
  editable?: boolean;
  stagedSource?: string;
  onStorageConvert?: (source: string) => boolean | void | Promise<boolean | void>;
  onMediaOpen?: (target: MediaPreviewTarget) => void;
}) {
  const path = useMemo(() => resolveLocalImagePath(source, baseDir), [baseDir, source]);
  const [document, setDocument] = useState<MarkdownLoadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let active = true;
    setDocument(null);
    setError(null);
    if (stagedSource !== undefined) {
      setLoading(false);
      return () => { active = false; };
    }
    if (!path) {
      setLoading(false);
      setError("ローカルdraw.ioファイルのパスを解決できません。");
      return () => { active = false; };
    }
    setLoading(true);
    void loadMarkdown(path)
      .then((loaded) => {
        if (!active) return;
        if (loaded.kind !== "drawio") throw new Error("参照先はdraw.ioファイルではありません。");
        setDocument(loaded);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [path, retryToken, stagedSource, version]);

  const save = async (content: string): Promise<boolean> => {
    if (!document) return false;
    const result = await saveMarkdown({
      path: document.path,
      content,
      expectedRevision: document.revision,
      stagedAssetIds: [],
    });
    if (result.status === "conflict") {
      throw new Error("参照先のdraw.ioファイルが更新されています。再読込してから編集してください。");
    }
    setDocument(result.document);
    setError(null);
    emitToast("success", `${result.document.path} を保存しました`);
    return true;
  };

  if (loading) return <div className="drawio-block"><div className="drawio-block__preview">draw.ioファイルを読み込んでいます…</div></div>;
  if (error || (!document && stagedSource === undefined)) return <div className="drawio-block">
    <div className="drawio-block__preview drawio-block__fallback">
      <p>{error ?? "draw.ioファイルを読み込めません。"}</p>
      <button type="button" onClick={() => setRetryToken((value) => value + 1)}>再読込</button>
    </div>
  </div>;

  return <div className="external-drawio-block" data-drawio-source={source}>
    <DrawioBlock
      source={stagedSource ?? document!.content}
      theme={theme}
      blockId={blockId}
      storage="external"
      onStorageConvert={editable && onStorageConvert ? () => onStorageConvert(stagedSource ?? document!.content) : undefined}
      onSave={editable && document ? save : undefined}
      onMediaOpen={onMediaOpen}
    />
    {alt?.trim() && <span className="inline-image-resize__caption">{alt}</span>}
  </div>;
}
