import { useEffect, useMemo, useState } from "react";
import type { CodexLogData } from "./model";

export function CodexLogViewer({ data, onClose, onLimitChange }: { data: CodexLogData; onClose: () => void; onLimitChange: (limit: number) => Promise<void> }) {
  const [selectedId, setSelectedId] = useState<string | null>(data.entries[0]?.id ?? null);
  const [responseMode, setResponseMode] = useState<"message" | "raw">("message");
  const [limit, setLimit] = useState(String(data.limit));
  useEffect(() => { if (!data.entries.some((entry) => entry.id === selectedId)) setSelectedId(data.entries[0]?.id ?? null); }, [data.entries, selectedId]);
  useEffect(() => setLimit(String(data.limit)), [data.limit]);
  const selected = data.entries.find((entry) => entry.id === selectedId) ?? null;
  const totals = useMemo(() => data.entries.reduce((sum, entry) => ({ input: sum.input + (entry.inputTokens ?? 0), output: sum.output + (entry.outputTokens ?? 0), counted: sum.counted + Number(entry.inputTokens !== null || entry.outputTokens !== null) }), { input: 0, output: 0, counted: 0 }), [data.entries]);
  async function saveLimit() {
    const value = Number(limit);
    if (!Number.isInteger(value) || value < 1 || value > 1000) return;
    await onLimitChange(value);
  }
  return <div className="codex-log-viewer" role="dialog" aria-modal="true" aria-label="Codex通信ログ" onKeyDownCapture={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <header><strong>Codex通信ログ</strong><button type="button" onClick={onClose} aria-label="Codex通信ログを閉じる">×</button></header>
    <div className="codex-log-viewer__content">
      <nav aria-label="Codex通信ログ一覧">
        <div className="codex-log-viewer__list">{data.entries.length === 0 ? <p>保存済みのログはありません。</p> : data.entries.map((entry, index) => <button key={entry.id} type="button" className={entry.id === selectedId ? "is-selected" : ""} aria-pressed={entry.id === selectedId} onClick={() => setSelectedId(entry.id)}>
          <strong>{index + 1}. {new Date(entry.createdAt).toLocaleString()}</strong><span>{entry.model}</span><small>入力 {entry.inputTokens?.toLocaleString() ?? "—"}</small><small>出力 {entry.outputTokens?.toLocaleString() ?? "—"}</small>
        </button>)}</div>
        <footer><div className="codex-log-viewer__summary">送信 {totals.input.toLocaleString()} tokens / 受信 {totals.output.toLocaleString()} tokens<br /><small>使用量を取得できた {totals.counted}件の合計</small></div><label>最大件数<input aria-label="通信ログの最大件数" value={limit} inputMode="numeric" onChange={(event) => setLimit(event.target.value)} onBlur={() => void saveLimit()} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveLimit(); } }} /></label><small>1〜1,000件</small></footer>
      </nav>
      {selected ? <main aria-label="選択したCodex通信ログ">
        <section><h2>送信リクエスト</h2><p>Codex CLIの標準入力へ渡したプレーンテキストです。</p><pre>{selected.requestPrompt}</pre></section>
        <section><h2>受信応答</h2><div className="codex-log-viewer__response-controls"><p>{responseMode === "message" ? "Codex CLIから応答があったメッセージです。" : "Codex CLIが返したオリジナルのJSONLデータです。"}</p><div role="group" aria-label="受信応答の表示内容"><button type="button" className={responseMode === "message" ? "is-active" : ""} onClick={() => setResponseMode("message")}>メッセージ</button><button type="button" className={responseMode === "raw" ? "is-active" : ""} onClick={() => setResponseMode("raw")}>オリジナルJSONL</button></div></div><pre>{responseMode === "message" ? selected.responseText : selected.responseRaw}</pre></section>
      </main> : <main className="codex-log-viewer__empty">左側からログを選択してください。</main>}
    </div>
  </div>;
}
