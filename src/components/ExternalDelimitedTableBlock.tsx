import { useEffect, useMemo, useState } from "react";
import { readDocumentAsset } from "../lib/commands";
import { resolveLocalImagePath } from "../lib/path";
import type { DelimitedTableLanguage } from "../lib/delimitedTable";
import { DelimitedTableBlock } from "./DelimitedTableBlock";
import { ExternalFileHeader } from "./ExternalFileHeader";

export function ExternalDelimitedTableBlock({
  source,
  baseDir,
  documentPath,
  language,
  version,
  onStorageConvert,
  onRename,
  onError,
}: {
  source: string;
  baseDir: string;
  documentPath: string;
  language: DelimitedTableLanguage;
  version: number;
  onStorageConvert?: (source: string) => boolean | void | Promise<boolean | void>;
  onRename?: (filename: string) => boolean | void | Promise<boolean | void>;
  onError?: (message: string) => void;
}) {
  const path = useMemo(() => resolveLocalImagePath(source, baseDir), [baseDir, source]);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  useEffect(() => {
    let active = true;
    setContent(null);
    setError(null);
    void readDocumentAsset(documentPath, source).then((asset) => {
      if (!active) return;
      if (asset.text === null || asset.text === undefined) throw new Error("表ファイルをテキストとして読み込めません。");
      setContent(asset.text.replace(/^\uFEFF/, ""));
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : String(loadError));
    });
    return () => { active = false; };
  }, [documentPath, retryToken, source, version]);

  if (error) return <div className="data-grid-error" role="alert">{error}<button type="button" onClick={() => setRetryToken((value) => value + 1)}>再読込</button></div>;
  if (content === null) return <div className="data-grid-error">表ファイルを読み込んでいます…</div>;
  return <DelimitedTableBlock
    language={language}
    source={content}
    headingLabel={<ExternalFileHeader source={source} path={path} kind={language.toUpperCase()} status={version > 0 ? "更新あり" : undefined} onRename={onRename} onError={onError} />}
    storage="external"
    onStorageConvert={onStorageConvert ? () => onStorageConvert(content) : undefined}
  />;
}
