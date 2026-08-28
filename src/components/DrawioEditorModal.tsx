import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { disableDrawioPageView, DRAWIO_EDITOR_URL, DRAWIO_ORIGIN, extractDrawioFenceData, parseTrustedDrawioMessage, prepareDrawioLoad } from "../lib/drawio";

export function DrawioEditorModal({ source, onSave, onCancel }: {
  source: string;
  onSave: (source: string) => boolean | void | Promise<boolean | void>;
  onCancel: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const payload = useMemo(() => prepareDrawioLoad(source), [source]);
  const [status, setStatus] = useState("draw.ioを読み込んでいます…");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => setError("draw.ioから初期化通知を受信できませんでした。ネットワーク接続を確認して再試行してください。"), 20_000);
    const centerTimers: number[] = [];
    const centerDrawing = (frameWindow: Window | null) => {
      frameWindow?.postMessage(JSON.stringify({ action: "fit", border: 48, maxScale: 1 }), DRAWIO_ORIGIN);
      frameWindow?.postMessage(JSON.stringify({ action: "invokeAction", actionName: "fitWindow" }), DRAWIO_ORIGIN);
    };
    const scheduleCentering = (frameWindow: Window | null, delays: number[]) => {
      delays.forEach((delay) => centerTimers.push(window.setTimeout(() => centerDrawing(frameWindow), delay)));
    };
    const receive = (event: MessageEvent) => {
      const frameWindow = iframeRef.current?.contentWindow ?? null;
      const message = parseTrustedDrawioMessage(event, frameWindow);
      if (!message) return;
      if (message.event === "init") {
        window.clearTimeout(timeout);
        setStatus("編集中");
        setError(null);
        const load: Record<string, unknown> = {
          action: "load",
          title: "Markdown diagram",
          noSaveBtn: 1,
          saveAndExit: 1,
          fit: 1,
          border: 48,
          maxFitScale: 1,
        };
        if ("descriptor" in payload) load.descriptor = payload.descriptor;
        else load.xml = disableDrawioPageView(payload.xml);
        frameWindow?.postMessage(JSON.stringify(load), DRAWIO_ORIGIN);
        scheduleCentering(frameWindow, [80, 320, 900]);
      } else if (message.event === "load") {
        // 読み込み後に図形境界が確定するため、編集領域のレイアウト確定後にも
        // draw.io標準の「ウィンドウに合わせる」を繰り返して中央へ配置する。
        centerDrawing(frameWindow);
        scheduleCentering(frameWindow, [240, 720]);
      } else if (message.event === "save" && typeof message.xml === "string" && message.xml.length <= 20 * 1024 * 1024) {
        setSaving(true);
        Promise.resolve(onSave(extractDrawioFenceData(message.xml))).then((saved) => {
          if (saved === false) throw new Error("Markdown側で対象ブロックが変更されています。");
          if (message.exit) onCancel();
          else setStatus("保存内容をMarkdownドラフトへ反映しました");
        }).catch((saveError) => setError(saveError instanceof Error ? saveError.message : String(saveError))).finally(() => setSaving(false));
      } else if (message.event === "save") {
        setError("draw.ioから受信した保存データが不正または大きすぎます。");
      } else if (message.event === "exit") onCancel();
    };
    window.addEventListener("message", receive);
    return () => {
      window.clearTimeout(timeout);
      centerTimers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("message", receive);
    };
  }, [onCancel, onSave, payload, retryToken]);

  return createPortal(<div className="drawio-editor" role="dialog" aria-modal="true" aria-label="draw.io図の編集">
    <header className="drawio-editor__header">
      <strong>draw.io図の編集</strong>
      <span>{saving ? "Markdownへ反映中…" : status}</span>
      <button type="button" onClick={onCancel}>キャンセル</button>
    </header>
    {payload.warnings.length > 0 && <div className="drawio-editor__warnings" role="status">
      {payload.warnings.map((warning) => <p key={warning}>{warning}</p>)}
    </div>}
    {error && <div className="drawio-editor__error" role="alert">
      <span>{error}</span>
      <button type="button" onClick={() => { setError(null); setStatus("draw.ioを再読み込みしています…"); setRetryToken((value) => value + 1); }}>再試行</button>
    </div>}
    <iframe
      ref={iframeRef}
      key={retryToken}
      src={DRAWIO_EDITOR_URL}
      title="draw.io editor"
      allow="clipboard-read; clipboard-write"
      referrerPolicy="no-referrer"
    />
  </div>, document.body);
}
