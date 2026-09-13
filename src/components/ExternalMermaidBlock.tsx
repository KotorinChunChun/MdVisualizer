import { useEffect, useMemo, useState } from "react";
import { loadMarkdown, saveMarkdown } from "../lib/commands";
import { getFileName, resolveLocalImagePath } from "../lib/path";
import type { MediaPreviewTarget } from "./MediaPreviewModal";
import { MermaidBlock } from "./MermaidBlock";
import { ExternalFileHeader } from "./ExternalFileHeader";
import { FileSvgCodexAction } from "../features/codex/FileSvgCodexAction";
import { useBrowserCapabilities } from "./BrowserCapabilities";

function emitToast(type: "success" | "error", message: string) {
  window.dispatchEvent(new CustomEvent("markdown-toast", { detail: { type, message } }));
}

export function ExternalMermaidBlock({
  source,
  alt,
  baseDir,
  theme,
  blockId,
  version,
  editable = true,
  stagedSource,
  onStagedSourceChange,
  onStorageConvert,
  onRename,
  onError,
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
  onStagedSourceChange?: (source: string) => boolean | void | Promise<boolean | void>;
  onStorageConvert?: (source: string, alt?: string) => boolean | void | Promise<boolean | void>;
  onRename?: (filename: string) => boolean | void | Promise<boolean | void>;
  onError?: (message: string) => void;
  onMediaOpen?: (target: MediaPreviewTarget) => void;
}) {
  const capabilities = useBrowserCapabilities();
  const path = useMemo(() => resolveLocalImagePath(source, baseDir), [baseDir, source]);
  const [document, setDocument] = useState<Awaited<ReturnType<typeof loadMarkdown>> | null>(null);
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
      setError("ローカルMermaidファイルのパスを解決できません。");
      return () => { active = false; };
    }
    setLoading(true);
    void loadMarkdown(path).then((loaded) => {
      if (!active) return;
      if (loaded.kind !== "mermaid") throw new Error("参照先はMermaidファイルではありません。");
      setDocument(loaded);
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : String(loadError));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [path, retryToken, stagedSource, version]);

  if (loading) return <div className="mermaid-container"><div className="mermaid-loading">Mermaidファイルを読み込んでいます…</div></div>;
  if (error || (document === null && stagedSource === undefined)) return <div className="mermaid-container"><div className="mermaid-error" role="alert"><strong>{error ?? "Mermaidファイルを読み込めません。"}</strong><button type="button" onClick={() => setRetryToken((value) => value + 1)}>再読込</button></div></div>;
  const diagramSource = stagedSource ?? document!.content;
  const save = async (nextSource: string): Promise<boolean> => {
    if (stagedSource !== undefined) {
      if (!onStagedSourceChange) return false;
      const accepted = await onStagedSourceChange(nextSource);
      if (accepted === false) return false;
      emitToast("success", `${source} の一時ステージを更新しました`);
      return true;
    }
    if (!document) return false;
    const result = await saveMarkdown({ path: document.path, content: nextSource, expectedRevision: document.revision, stagedAssetIds: [] });
    if (result.status === "conflict") throw new Error("参照先のMermaidファイルが更新されています。再読込してから編集してください。");
    setDocument(result.document);
    setError(null);
    emitToast("success", `${result.document.path} を保存しました`);
    return true;
  };
  const preview = <div className="external-mermaid-block" data-mermaid-source={source}>
    <MermaidBlock
      source={diagramSource}
      mediaSource={diagramSource}
      theme={theme}
      mode="on"
      blockId={blockId}
      diagramIndex={0}
      diagramCount={1}
      headingTitle={getFileName(path ?? source)}
      description={alt}
      headingLabel={<ExternalFileHeader source={source} path={path} kind="Mermaid" status={version > 0 ? "更新あり" : undefined} onRename={onRename} onError={onError} />}
      editable={editable}
      onSourceChange={editable && (document || (stagedSource !== undefined && onStagedSourceChange)) ? save : undefined}
      storage="external"
      onStorageConvert={editable && onStorageConvert ? () => onStorageConvert(diagramSource, alt?.trim() || undefined) : undefined}
      onMediaOpen={onMediaOpen}
    />
  </div>;
  return editable && capabilities.canUseCodexActions && path && stagedSource === undefined ? <FileSvgCodexAction kind="mermaid" path={path} onSaved={() => setRetryToken((value) => value + 1)}>{preview}</FileSvgCodexAction> : preview;
}
