import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { loadSettings, saveSettings } from "../../lib/commands";
import { cancelCodex, generateCodex, listCodexLogs, setCodexLogLimit } from "./api";
import { canApplyProposal, DEFAULT_CODEX_OPTIONS, normalizeCodexOptions, requestBytes, type ChatMessage, type CodexLogData, type EditorSnapshot } from "./model";
import { CodexLogViewer } from "./CodexLogViewer";
import { buildProposalDiff } from "./proposalDiff";
import "./codex.css";
import { IMAGE_INSTRUCTION, imageInsertion, loadTranscriptionImage, transcriptionImages } from "./imageTranscription";
import { resolveImageSrc } from "../../lib/path";
import { diagramInstruction, validateDiagramReplacement, type CodexDiagramKind } from "./diagram";

export function CodexPanel({ open: visible, onClose, documentName, documentText, documentPath = "", baseDir = "", imageTarget, stagedImages = {}, available, getSnapshot, applyProposal, applyProposalAsync, diagramKind, renderProposal }: {
  open: boolean; onClose: () => void; documentName: string; documentText: string; available: boolean;
  documentPath?: string; baseDir?: string;
  imageTarget?: { offset: number } | null; stagedImages?: Record<string, string>;
  getSnapshot: () => EditorSnapshot | null;
  applyProposal: (base: EditorSnapshot, replacement: string) => boolean;
  applyProposalAsync?: (base: EditorSnapshot, replacement: string) => Promise<boolean>;
  diagramKind?: CodexDiagramKind;
  renderProposal?: (replacement: string) => React.ReactNode;
}) {
  const [options, setOptions] = useState(DEFAULT_CODEX_OPTIONS);
  const [savedOptions, setSavedOptions] = useState(DEFAULT_CODEX_OPTIONS);
  const [ready, setReady] = useState(false);
  const [savingOptions, setSavingOptions] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [imageId, setImageId] = useState("");
  const images = useMemo(() => transcriptionImages(documentText), [documentText]);
  const selectedImage = images.find((image) => image.id === imageId);
  useEffect(() => { if (imageTarget) setImageId(images.find((image) => image.start === imageTarget.offset)?.id ?? ""); }, [imageTarget]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [selection, setSelection] = useState<EditorSnapshot | null>(null);
  const [proposal, setProposal] = useState<{ base: EditorSnapshot; replacement: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<CodexLogData>({ entries: [], limit: 20 });
  const [width, setWidth] = useState(420);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const active = useRef<string | null>(null);
  const cancelled = useRef(false);
  const mounted = useRef(false);
  const latest = useRef({ available, applyProposal, getSnapshot });
  latest.current = { available, applyProposal, getSnapshot };
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!previewOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    preview.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [previewOpen]);
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    void loadSettings().then((settings) => {
      if (disposed) return;
      const value = normalizeCodexOptions(settings.codex);
      setOptions(value); setSavedOptions(value); setReady(true);
    }).catch(() => { if (!disposed) setError("設定を読み込めません。パネルを開き直してください。"); });
    void refreshLogs();
    return () => { disposed = true; mounted.current = false; if (active.current) void cancelCodex(active.current).catch(() => {}); };
  }, []);
  useEffect(() => { if (visible && savedOptions.enabled) input.current?.focus(); }, [visible, savedOptions.enabled]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [history, busy]);
  useEffect(() => { if (!status) return; const timer = window.setTimeout(() => setStatus(""), 4000); return () => window.clearTimeout(timer); }, [status]);
  const diff = useMemo(() => proposal ? buildProposalDiff(proposal.base.content.slice(proposal.base.from, proposal.base.to), proposal.replacement) : [], [proposal]);
  const settingsDirty = JSON.stringify(options) !== JSON.stringify(savedOptions);

  async function refreshLogs() {
    try { setLogs(await listCodexLogs()); }
    catch { if (mounted.current) setError("Codex通信ログを読み込めません。"); }
  }
  async function showLogs() {
    await refreshLogs();
    if (mounted.current) setLogsOpen(true);
  }
  async function changeLogLimit(limit: number) {
    try { setLogs(await setCodexLogLimit(limit)); }
    catch { if (mounted.current) setError("Codex通信ログの最大件数を保存できません。"); }
  }

  async function persistOptions() {
    setSavingOptions(true); setError("");
    try {
      const value = normalizeCodexOptions(options);
      if (!/^[a-zA-Z0-9._-]{1,100}$/.test(value.model)) throw new Error("モデル名を確認してください。");
      await saveSettings({ codex: value });
      if (!mounted.current) return;
      setOptions(value); setSavedOptions(value); setStatus(value.enabled ? "Codex連携を有効にしました。" : "Codex連携を無効にしました。");
      if (!value.enabled) { setHistory([]); setProposal(null); setPreviewOpen(false); setSelection(null); }
    } catch (cause) { if (mounted.current) setError(String(cause)); }
    finally { if (mounted.current) setSavingOptions(false); }
  }
  function captureSelection() {
    const snapshot = getSnapshot();
    if (!snapshot || snapshot.from === snapshot.to) { setError("エディタで対象の文章を選択してから取り込んでください。"); return; }
    setSelection(snapshot); setProposal(null); setPreviewOpen(false); setError("");
  }
  async function stop() {
    cancelled.current = true;
    setProposal(null); setPreviewOpen(false); setStatus("停止中…");
    if (active.current) {
      try { await cancelCodex(active.current); }
      catch { if (mounted.current) setError("停止要求を送れませんでした。応答は採用せず、タイムアウトを待ちます。"); }
    }
  }
  async function send() {
    if (active.current || applyingRef.current || !savedOptions.enabled || settingsDirty || !available || !instruction.trim()) return;
    const current = getSnapshot();
    if (!current) { setError("編集画面を開いてから送信してください。"); return; }
    if (selection && !canApplyProposal(current, selection)) { setError("選択後に本文が変わりました。選択範囲を取り込み直してください。"); return; }
    const base = selection ?? { ...current, from: 0, to: current.content.length };
    const text = base.content.slice(base.from, base.to);
    if (history.length > 40 || requestBytes(instruction, text, history) > 120000) { setError("送信量が上限を超えています。選択範囲を縮めるか会話をクリアしてください。"); return; }
    const id = crypto.randomUUID();
    active.current = id; cancelled.current = false;
    setBusy(true); setError(""); setProposal(null); setPreviewOpen(false); setStatus("Codexが回答を生成しています…");
    const user: ChatMessage = { role: "user", text: instruction.trim() };
    try {
      const reply = await generateCodex({ id, instruction: diagramKind ? diagramInstruction(diagramKind, user.text) : user.text, text, history });
      if (!mounted.current || cancelled.current) return;
      // 変更案も会話に含めることで「もう少し短く」などの継続指示を可能にする。
      setHistory((old) => [...old, user, { role: "assistant", text: reply.answer + (reply.replacement !== null ? `\n\n変更案:\n${reply.replacement}` : "") }]);
      setInstruction("");
      if (reply.replacement !== null) { setProposal({ base, replacement: (diagramKind ? validateDiagramReplacement(diagramKind, reply.replacement) : reply.replacement).replace(/\r\n?|\n/g, "\n") }); setPreviewOpen(true); }
      void refreshLogs();
      setStatus(reply.replacement === null ? "回答を受信しました。" : "変更案を受信しました。差分を確認して採用できます。");
    } catch (cause) { if (mounted.current && !cancelled.current) setError(String(cause)); }
    finally {
      active.current = null;
      if (mounted.current) { setBusy(false); if (cancelled.current) setStatus("停止しました。変更案は破棄しました。"); }
    }
  }
  async function transcribeImage() {
    if (active.current || !savedOptions.enabled || settingsDirty || !available || !selectedImage) return;
    const current = getSnapshot();
    if (!current || current.content.replace(/\r\n?/g, "\n") !== documentText.replace(/\r\n?/g, "\n")) { setError("本文が変わりました。画像を選択し直してください。"); return; }
    // CodeMirrorはLFへ正規化するため、表示元のCRLFオフセットをそのまま使わない。
    const target = transcriptionImages(current.content)[images.indexOf(selectedImage)];
    if (!target || target.source !== selectedImage.source) { setError("画像を選択し直してください。"); return; }
    const id = crypto.randomUUID();
    active.current = id; cancelled.current = false;
    setBusy(true); setError(""); setProposal(null); setPreviewOpen(false);
    setStatus("画像の解説・文字起こしを生成しています…");
    try {
      imageInsertion(current.content, target, "位置確認");
      const image = await loadTranscriptionImage(documentPath, stagedImages[selectedImage.source] ?? selectedImage.source);
      if (!mounted.current || cancelled.current) return;
      if (image.base64.length > 14_000_000) throw new Error("画像は10MB以下にしてください。");
      const reply = await generateCodex({ id, instruction: IMAGE_INSTRUCTION, text: "", history: [], image });
      if (!mounted.current || cancelled.current) return;
      const insertion = imageInsertion(current.content, target, reply.answer);
      const base = { ...current, from: insertion.from, to: insertion.to };
      if (!latest.current.available || !canApplyProposal(latest.current.getSnapshot(), base) || !latest.current.applyProposal(base, insertion.replacement)) throw new Error("生成中に本文や文書が変わったため挿入しませんでした。最新の画像で実行し直してください。");
      setSelection(null); setImageId("");
      setStatus("画像の直下に挿入しました。Ctrl+Zで戻せます。保存は通常の保存操作で行ってください。");
      void refreshLogs();
    } catch (cause) { if (mounted.current && !cancelled.current) setError(String(cause)); }
    finally { active.current = null; if (mounted.current) { setBusy(false); if (cancelled.current) setStatus("停止しました。"); } }
  }
  async function adopt() {
    if (!proposal || !available || busy || applyingRef.current) return;
    applyingRef.current = true; setApplying(true); setError("");
    try {
      if (!canApplyProposal(latest.current.getSnapshot(), proposal.base)) throw new Error("生成後に本文や文書が変わりました。最新の本文で生成し直してください。");
      const accepted = applyProposalAsync ? await applyProposalAsync(proposal.base, proposal.replacement) : applyProposal(proposal.base, proposal.replacement);
      if (!accepted) throw new Error("生成後に本文や文書が変わりました。最新の本文で生成し直してください。");
      if (!mounted.current) return;
      setProposal(null); setPreviewOpen(false); setSelection(null); setError(""); setStatus(diagramKind ? "図に反映しました。" : "ドラフトに反映しました。Ctrl+Zで戻せます。保存は通常の保存操作で行ってください。");
    } catch (cause) { if (mounted.current) setError(String(cause)); }
    finally { applyingRef.current = false; if (mounted.current) setApplying(false); }
  }
  const capturedText = selection?.content.slice(selection.from, selection.to);
  const sendBytes = requestBytes(instruction, capturedText ?? documentText.replace(/\r\n?/g, "\n"), history);
  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const resize = (move: PointerEvent) => setWidth(Math.max(300, Math.min(760, window.innerWidth - move.clientX)));
    const finish = () => { window.removeEventListener("pointermove", resize); window.removeEventListener("pointerup", finish); };
    window.addEventListener("pointermove", resize); window.addEventListener("pointerup", finish, { once: true });
  }
  return <aside hidden={!visible} className="codex-panel" style={{ "--codex-panel-width": `${width}px` } as React.CSSProperties} aria-label="Codex文章アシスタント" onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); if (applyingRef.current) return; if (busy) void stop(); onClose(); }
  }}>
    <div className="codex-panel__resize" role="separator" aria-label="Codexパネルの幅を変更" aria-orientation="vertical" aria-valuemin={300} aria-valuemax={760} aria-valuenow={width} tabIndex={0} onPointerDown={beginResize} onKeyDown={(event) => {
      if (event.key === "ArrowLeft") { event.preventDefault(); setWidth((value) => Math.min(760, value + 20)); }
      if (event.key === "ArrowRight") { event.preventDefault(); setWidth((value) => Math.max(300, value - 20)); }
    }} />
    <header inert={previewOpen || logsOpen}><strong>Codex{diagramKind ? ` — ${diagramKind === "svg" ? "SVG" : "draw.io"}` : ""}</strong><div><button type="button" onClick={() => void showLogs()}>ログ（{logs.entries.length}）</button><button type="button" disabled={applying} onClick={() => { if (busy) void stop(); onClose(); }} aria-label="Codexパネルを閉じる">×</button></div></header>
    <div className="codex-panel__body" inert={previewOpen || logsOpen}>
      <details open={!savedOptions.enabled}>
        <summary>連携設定（任意）</summary>
        <p>利用する場合だけCodex CLIを導入し、外部ターミナルで <code>codex login</code> を実行してください。CLI 0.153.4で検証済みです。</p>
        <fieldset disabled={!ready || busy || savingOptions}>
          <label><input type="checkbox" checked={options.enabled} onChange={(e) => setOptions({ ...options, enabled: e.target.checked })} />Codex連携を有効にする</label>
          <p>Codex CLIは自動検出します。PATHを優先し、公式Windowsインストーラーのユーザー領域も確認します。</p>
          <label>モデル<input value={options.model} onChange={(e) => setOptions({ ...options, model: e.target.value })} /></label>
          <button type="button" disabled={!settingsDirty} onClick={() => void persistOptions()}>連携設定を保存</button>
        </fieldset>
      </details>
      {savedOptions.enabled && <>
        <section className="codex-panel__scope"><strong>取り込み範囲と送信設定</strong><p>対象: {documentName || "文書なし"}<br />モデル: {savedOptions.model}<br />送信先: Codex（OpenAI）</p></section>
        {!available && <p>ローカルMarkdownの編集画面で利用できます。保存中・差分画面では採用できません。</p>}
        {!diagramKind && <section aria-label="画像の解説・文字起こし">
          <label>対象画像<select value={imageId} disabled={busy || !available} onChange={(event) => setImageId(event.target.value)}>
            <option value="">画像を選択してください</option>
            {images.map((image) => <option key={image.id} value={image.id}>{image.sourceLine}行: {image.caption || "画像"}</option>)}
          </select></label>
          {selectedImage && <img className="codex-image-preview" src={stagedImages[selectedImage.source] ?? resolveImageSrc(selectedImage.source, baseDir)} alt={selectedImage.caption || "選択した画像"} />}
          <p>選択した画像をCodexへ送信し、解説と文字起こしを画像直下のコードブロックへ挿入します。独立した行のローカル画像・埋め込み画像が対象です。</p>
          <button type="button" disabled={busy || !available || !selectedImage || settingsDirty} onClick={() => void transcribeImage()}>解説・文字起こしを挿入</button>
        </section>}
        <div className="codex-panel__actions">
          {!diagramKind && <button type="button" disabled={busy || !available} onClick={captureSelection}>選択範囲を取り込む</button>}
          <button type="button" disabled={busy || !selection} onClick={() => { setSelection(null); setProposal(null); setPreviewOpen(false); }}>全文を対象にする</button>
          <button type="button" disabled={busy} onClick={() => { setHistory([]); setProposal(null); setPreviewOpen(false); setError(""); setStatus("会話をクリアしました。"); }}>会話をクリア</button>
        </div>
        <p>{selection ? `選択範囲 ${capturedText?.length ?? 0}文字` : "送信時の編集中の全文"}と、このパネルの会話を送信します。会話はパネルを閉じるか文書を切り替えると消えます。</p>
        <p>本文・指示・会話: {sendBytes.toLocaleString()} / 120,000 bytes</p>
        {selection && <details><summary>送信する選択範囲</summary><pre>{capturedText}</pre></details>}
        <div ref={log} className="codex-panel__chat" role="log" aria-label="Codexとの会話">
          {history.map((message, index) => <section key={index} className={`codex-message codex-message--${message.role}`}><strong>{message.role === "user" ? "あなた" : "Codex"}</strong><pre>{message.text}</pre></section>)}
          {busy && <p>回答を待っています…</p>}
        </div>
        {diagramKind && <div className="codex-panel__actions"><button type="button" disabled={busy || applying} onClick={() => { setInstruction("意味や接続関係、ラベルを保ったまま、配置・余白・文字サイズ・色を整えて読みやすい図に整形してください。"); input.current?.focus(); }}>整形する</button><button type="button" disabled={busy || applying} onClick={() => { setInstruction("次の内容の図を描いてください：\n"); input.current?.focus(); }}>図を描く</button></div>}
        <label>指示<textarea ref={input} value={instruction} rows={4} disabled={busy || applying} placeholder={diagramKind ? "例: 整形して／利用者→API→データベースの構成図を描いて" : "例: この説明を短くしてください"} onChange={(e) => setInstruction(e.target.value)} onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); void send(); }
        }} /></label>
        <div className="codex-panel__actions">
          <button type="button" disabled={busy || applying || !available || !instruction.trim() || settingsDirty || sendBytes > 120000 || history.length > 40} onClick={() => void send()}>送信（Ctrl+Enter）</button>
          <button type="button" disabled={!busy} onClick={() => void stop()}>停止</button>
        </div>
        {proposal && <section className="codex-proposal" aria-label="AI変更案">
          <h3>変更案を受信しました</h3><button type="button" onClick={() => setPreviewOpen(true)}>大きな画面でプレビュー</button>
        </section>}
      </>}
      {settingsDirty && <p>変更した設定を保存してから送信してください。</p>}
      {(sendBytes > 120000 || history.length > 40) && <p>送信量が上限を超えています。選択範囲を縮めるか会話をクリアしてください。</p>}
      {error && !previewOpen && <p role="alert">{error}</p>}
      <p role="status">{status}</p>
    </div>
    {proposal && previewOpen && <div ref={preview} tabIndex={-1} className="codex-proposal-preview" role="dialog" aria-modal="true" aria-label="Codex変更案のプレビュー" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!applying) setPreviewOpen(false); }
    }}>
      <header><div><strong>変更案のプレビュー</strong><p>− 現在の対象 / ＋ 提案内容 / ↵ 末尾改行</p></div><button type="button" disabled={applying} onClick={() => setPreviewOpen(false)} aria-label="変更案プレビューを閉じる">×</button></header>
      <pre className="codex-diff">{diff.map((line, index) => <span key={index} className={`codex-diff--${line.kind}`}>{line.text}{"\n"}</span>)}</pre>
      {renderProposal?.(proposal.replacement)}
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={busy || applying || !available} onClick={() => void adopt()}>{applying ? "反映中…" : "採用"}</button><button type="button" disabled={applying} onClick={() => { setProposal(null); setPreviewOpen(false); }}>却下</button></footer>
    </div>}
    {logsOpen && <CodexLogViewer data={logs} onClose={() => setLogsOpen(false)} onLimitChange={changeLogLimit} />}
  </aside>;
}
