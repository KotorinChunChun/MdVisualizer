import { useEffect, useState } from "react";
import type { TabState } from "../state/tabsReducer";
import { documentWatchTargets, removeWindowWatchTargets, syncWatchTargets } from "../lib/commands";
import { isSharePointDocument } from "../lib/sharePoint";
import type { AutoReloadSetting } from "./useApplicationSettings";

/** 文書revisionに対応する参照解析と、ウィンドウ所有の監視を一か所で管理する。 */
export function useDocumentWatchTargets({ tabs, autoReload, windowLabel, diffPath }: {
  tabs: readonly Pick<TabState, "document" | "untitled">[];
  autoReload: AutoReloadSetting;
  windowLabel: string;
  diffPath?: string;
}) {
  const [diagnosticWatchTargets, setDiagnosticWatchTargets] = useState<Record<string, string[]>>({});
  const documents = tabs.flatMap(tab => tab.document && !tab.untitled && !isSharePointDocument(tab.document) ? [tab.document] : []);
  const documentKey = JSON.stringify(documents.map(document => [document.path, document.revision]));
  const targetKey = JSON.stringify([...new Set(documents.flatMap(document => [
    ...(diagnosticWatchTargets[document.path] ?? [document.path]), ...document.image_paths,
  ]))].sort());

  useEffect(() => {
    let disposed = false;
    const paths = (JSON.parse(documentKey) as [string, string][]).map(([path]) => path);
    void Promise.all(paths.map(async path => [path, await documentWatchTargets(path)] as const)).then(entries => {
      if (!disposed) setDiagnosticWatchTargets(Object.fromEntries(entries));
    }).catch(() => {
      // 診断が取得できなくても、通常の本文・画像の監視を維持する。
    });
    return () => { disposed = true; };
  }, [documentKey]);

  useEffect(() => {
    // 自動更新OFFでも、開いている差分画面の監視は維持する。
    const targets: string[] = autoReload === "off" ? (diffPath ? [diffPath] : []) : JSON.parse(targetKey);
    if (targets.length > 0) void syncWatchTargets(windowLabel, targets);
    else void removeWindowWatchTargets(windowLabel);
  }, [targetKey, autoReload, windowLabel, diffPath]);

  useEffect(() => () => { void removeWindowWatchTargets(windowLabel); }, [windowLabel]);
  return diagnosticWatchTargets;
}
