import { useEffect, useMemo, useState } from "react";
import { loadMarkdown } from "../lib/commands";
import { getFileName, resolveLocalImagePath } from "../lib/path";
import type { MediaPreviewTarget } from "./MediaPreviewModal";
import { MermaidBlock } from "./MermaidBlock";
import { ExternalFileHeader } from "./ExternalFileHeader";
import { FileSvgCodexAction } from "../features/codex/FileSvgCodexAction";

export function ExternalMermaidBlock({
  source,
  alt,
  baseDir,
  theme,
  blockId,
  version,
  editable = true,
  stagedSource,
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
  onStorageConvert?: (source: string, alt?: string) => boolean | void | Promise<boolean | void>;
  onRename?: (filename: string) => boolean | void | Promise<boolean | void>;
  onError?: (message: string) => void;
  onMediaOpen?: (target: MediaPreviewTarget) => void;
}) {
  const path = useMemo(() => resolveLocalImagePath(source, baseDir), [baseDir, source]);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadedSource(null);
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
      setLoadedSource(loaded.content);
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : String(loadError));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [path, retryToken, stagedSource, version]);

  if (loading) return <div className="mermaid-container"><div className="mermaid-loading">Mermaidファイルを読み込んでいます…</div></div>;
  if (error || (loadedSource === null && stagedSource === undefined)) return <div className="mermaid-container"><div className="mermaid-error" role="alert"><strong>{error ?? "Mermaidファイルを読み込めません。"}</strong><button type="button" onClick={() => setRetryToken((value) => value + 1)}>再読込</button></div></div>;
  const diagramSource = stagedSource ?? loadedSource!;
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
      storage="external"
      onStorageConvert={editable && onStorageConvert ? () => onStorageConvert(diagramSource, alt?.trim() || undefined) : undefined}
      onMediaOpen={onMediaOpen}
    />
  </div>;
  return editable && path && stagedSource === undefined ? <FileSvgCodexAction kind="mermaid" path={path} onSaved={() => setRetryToken((value) => value + 1)}>{preview}</FileSvgCodexAction> : preview;
}
