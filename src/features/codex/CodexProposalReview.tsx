import { Fragment, useRef, useState, type ReactNode } from "react";
import { adoptProposalStableRow, createProposalStableState, editProposalStableState, proposalStableValue, restoreProposalOriginal } from "./proposalDiff";
import "./proposalReview.css";
import { useFocusTrap } from "../../hooks/useFocusTrap";

export function CodexProposalReview({ original, value, onChange, renderPreview, validate, onAccept, onReject, onClose, busy = false, error }: {
  original: string; value: string; onChange: (value: string) => void; renderPreview?: (source: string) => ReactNode;
  validate?: (source: string) => Promise<void> | void; onAccept: (value: string) => void | Promise<void>;
  onReject: () => void; onClose: () => void; busy?: boolean; error?: string;
}) {
  const focus = useFocusTrap<HTMLElement>(true);
  const [layout, setLayout] = useState<"horizontal" | "vertical">("horizontal");
  const [codeOpen, setCodeOpen] = useState(!renderPreview);
  const [validationError, setValidationError] = useState("");
  // 手編集でvalueが変わっても、行ごとの「生成案を再採用」は最初の提案へ戻せる。
  const originalSnapshot = useRef(original), stable = useRef(createProposalStableState(original, value));
  if (originalSnapshot.current !== original) { originalSnapshot.current = original; stable.current = createProposalStableState(original, value); }
  else if (proposalStableValue(stable.current) !== value) stable.current = editProposalStableState(stable.current, value);
  const rows = stable.current.rows;
  const copy = (source: string) => { void navigator.clipboard.writeText(source).catch(() => setValidationError("コピーできませんでした。")); };
  async function accept() {
    setValidationError("");
    try { await validate?.(value); await onAccept(value); }
    catch (cause) { setValidationError(cause instanceof Error ? cause.message : String(cause)); }
  }
  const update = (next: string) => { stable.current = editProposalStableState(stable.current, next); onChange(next); };
  const adopt = (id: string, side: "original" | "proposal") => { stable.current = adoptProposalStableRow(stable.current, id, side); onChange(proposalStableValue(stable.current)); };
  const hasPreview = Boolean(renderPreview);
  return <section ref={focus} className="codex-proposal-review" aria-label="Codex変更案の確認">
    <header className="codex-proposal-review__header"><strong>変更案の確認</strong><button type="button" onClick={onClose} disabled={busy} aria-label="変更案の確認を閉じる">×</button></header>
    {hasPreview && <div className="codex-proposal-review__tools"><button type="button" aria-pressed={layout === "horizontal"} onClick={() => setLayout("horizontal")}>左右配置</button><button type="button" aria-pressed={layout === "vertical"} onClick={() => setLayout("vertical")}>上下配置</button><button type="button" aria-expanded={codeOpen} onClick={() => setCodeOpen((open) => !open)}>{codeOpen ? "コード差分を隠す" : "コード差分を表示"}</button></div>}
    <div className={`codex-proposal-review__body${hasPreview && codeOpen ? " codex-proposal-review__body--split" : ""}`}>
    <div className="codex-proposal-review__code" hidden={!codeOpen}>
      <div className="codex-proposal-review__rows" aria-label="行単位の差分">
        <header><strong>変更前</strong><button type="button" onClick={() => copy(original)} aria-label="変更前をコピー">コピー</button></header><span aria-hidden="true" /><header><strong>変更後</strong><button type="button" onClick={() => copy(value)} aria-label="変更後をコピー">コピー</button></header>
        {rows.map((row, index) => <Fragment key={row.id}>
          <div className={`codex-proposal-review__line ${row.original !== row.current ? "codex-proposal-review__line--changed" : ""}`}>{row.original ?? "（なし）"}</div>
          <div className="codex-proposal-review__row-actions"><button type="button" disabled={busy || row.current === row.original} onClick={() => adopt(row.id, "original")} aria-label={`対応行${index + 1}を変更前へ戻す`}>←</button><button type="button" disabled={busy || row.current === row.proposal} onClick={() => adopt(row.id, "proposal")} aria-label={`対応行${index + 1}へ生成案を再採用`}>→</button></div>
          <div className={`codex-proposal-review__line ${row.original !== row.current ? "codex-proposal-review__line--changed" : ""}`}>{row.current ?? "（なし）"}</div>
        </Fragment>)}
        <label className="codex-proposal-review__editor-label">変更後を直接編集<textarea className="codex-proposal-review__editor" value={value} disabled={busy} onChange={(event) => update(event.target.value)} spellCheck={false} /></label>
      </div>
      <button type="button" disabled={busy || value === original} onClick={() => update(restoreProposalOriginal(original))}>変更前へ復旧</button>
    </div>
    {hasPreview && <div className={`codex-proposal-review__previews codex-proposal-review__previews--${layout}`} aria-label="変更前後のプレビュー"><article><strong>変更前プレビュー</strong>{renderPreview?.(original)}</article><article><strong>変更後プレビュー</strong>{renderPreview?.(value)}</article></div>}
    </div>
    {(error || validationError) && <p role="alert">{error || validationError}</p>}
    <footer className="codex-proposal-review__footer"><button type="button" disabled={busy} onClick={onReject}>却下</button><button type="button" disabled={busy} onClick={() => void accept()}>{busy ? "採用中…" : "採用"}</button></footer>
  </section>;
}
