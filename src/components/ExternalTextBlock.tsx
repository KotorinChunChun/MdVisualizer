import { useEffect, useMemo, useState } from "react";
import { readDocumentAsset } from "../lib/commands";
import { resolveLocalImagePath } from "../lib/path";
import { CodeBlock } from "./CodeBlock";
import { ExternalFileHeader } from "./ExternalFileHeader";

export function ExternalTextBlock({ source, baseDir, documentPath, version, onRename, onError }: {
  source: string;
  baseDir: string;
  documentPath: string;
  version: number;
  onRename?: (filename: string) => boolean | void | Promise<boolean | void>;
  onError?: (message: string) => void;
}) {
  const path = useMemo(() => resolveLocalImagePath(source, baseDir), [baseDir, source]);
  const extension = path?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "txt";
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setContent(null);
    setError(null);
    void readDocumentAsset(documentPath, source).then((asset) => {
      if (!active) return;
      if (asset.text === null || asset.text === undefined) throw new Error("外部テキストファイルを読み込めません。");
      setContent(asset.text.replace(/^\uFEFF/, ""));
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : String(loadError));
    });
    return () => { active = false; };
  }, [documentPath, source, version]);
  if (error) return <div className="code-error" role="alert">{error}</div>;
  if (content === null) return <div className="code-loading">外部テキストファイルを読み込んでいます…</div>;
  return <section className="external-text-block">
    <ExternalFileHeader source={source} path={path} kind={extension.toUpperCase()} status={version > 0 ? "更新あり" : undefined} onRename={onRename} onError={onError} />
    <CodeBlock className={`language-${extension}`} documentPath={documentPath}>{content}</CodeBlock>
  </section>;
}
