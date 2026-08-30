import { useRef, useState } from "react";
import { getMermaidStatus } from "../lib/mermaidStatus";
import { executePrintSession, waitForMermaidPrintReady, type PrintDevice } from "../lib/printSession";

/** 印刷用DOMの準備から出力・表示状態復元までを所有する。 */
export function useDocumentPrint<T>({
  getSnapshot, restore, onInfo, onError, print,
  waitForDiagrams = () => waitForMermaidPrintReady(getMermaidStatus),
}: {
  getSnapshot: () => T | null;
  restore: (snapshot: T) => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
  print?: PrintDevice;
  waitForDiagrams?: () => Promise<{ timedOut: boolean }>;
}) {
  const busy = useRef(false);
  const [printing, setPrinting] = useState(false);
  const [printStartedAt, setPrintStartedAt] = useState<Date | null>(null);
  const printDocument = async () => {
    if (busy.current) return;
    const snapshot = getSnapshot();
    if (snapshot === null) return;
    busy.current = true;
    setPrinting(true);
    setPrintStartedAt(new Date());
    try {
      // Reactの印刷用DOMと遅延図表を出力エンジンへ渡す前に確定する。
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      try {
        if ((await waitForDiagrams()).timedOut) onInfo("Mermaidの描画待機がタイムアウトしたため、現在の状態で印刷します。");
      } catch (error) {
        onInfo(`Mermaidの描画状態を確認できないため、現在の状態で印刷します: ${String(error)}`);
      }
      await executePrintSession({ print, restore: () => restore(snapshot) });
    } catch (error) {
      onError(`印刷を開始できません: ${String(error)}`);
    } finally {
      busy.current = false;
      setPrinting(false);
      setPrintStartedAt(null);
    }
  };
  return { printing, printStartedAt, printDocument };
}
