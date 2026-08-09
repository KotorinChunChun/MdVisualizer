import { useEffect, useRef, useState } from "react";
import type { LanguageFn } from "highlight.js";
import { runPowerShell, type PowerShellRunResult } from "../lib/commands";

interface CodeBlockProps {
  className?: string;
  children?: React.ReactNode;
  /** Signals that highlight.js has finished replacing the code DOM. */
  onHighlightComplete?: () => void;
  documentPath?: string;
}

type LanguageModule = { default: LanguageFn };

const languageLoaders: Record<string, () => Promise<LanguageModule>> = {
  bash: () => import("highlight.js/lib/languages/bash"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  css: () => import("highlight.js/lib/languages/css"),
  go: () => import("highlight.js/lib/languages/go"),
  html: () => import("highlight.js/lib/languages/xml"),
  java: () => import("highlight.js/lib/languages/java"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  json: () => import("highlight.js/lib/languages/json"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  powershell: () => import("highlight.js/lib/languages/powershell"),
  python: () => import("highlight.js/lib/languages/python"),
  rust: () => import("highlight.js/lib/languages/rust"),
  sql: () => import("highlight.js/lib/languages/sql"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  xml: () => import("highlight.js/lib/languages/xml"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
};

const languageAliases: Record<string, string> = {
  cs: "csharp", cxx: "cpp", htm: "html", js: "javascript", jsx: "javascript",
  ps: "powershell", ps1: "powershell", py: "python", rs: "rust", sh: "bash",
  shell: "bash", ts: "typescript", tsx: "typescript", yml: "yaml",
};

function emitCopyToast(type: "success" | "error", message: string): void {
  window.dispatchEvent(new CustomEvent("markdown-toast", { detail: { type, message } }));
}

export function CodeBlock({ className, children, onHighlightComplete, documentPath }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [html, setHtml] = useState("");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<PowerShellRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [workingDirectory, setWorkingDirectory] = useState(() => powerShellWorkingDirectory(documentPath ?? ""));
  const runGeneration = useRef(0);
  const runInFlight = useRef(false);
  const rawLanguage = className?.match(/language-([\w-]+)/)?.[1]?.toLowerCase();
  const language = rawLanguage ? languageAliases[rawLanguage] ?? rawLanguage : undefined;
  const source = String(children ?? "").replace(/\n$/, "");
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      import("highlight.js/lib/core"),
      language ? languageLoaders[language]?.() : undefined,
    ]).then(([{ default: hljs }, languageModule]) => {
      if (language && languageModule && !hljs.getLanguage(language)) hljs.registerLanguage(language, languageModule.default);
      const highlighted = language && hljs.getLanguage(language) ? hljs.highlight(source, { language }).value : "";
      if (!cancelled) setHtml(highlighted);
    }).catch(() => { if (!cancelled) setHtml(""); });
    return () => { cancelled = true; };
  }, [language, source]);
  useEffect(() => {
    // Run after React has committed highlight.js HTML so search can rescan the
    // final text nodes without competing with its DOM update.
    if (html) onHighlightComplete?.();
  }, [html, onHighlightComplete]);
  useEffect(() => {
    runGeneration.current += 1;
    runInFlight.current = false;
    setRunning(false);
    setRunResult(null);
    setRunError(null);
    setConfirmationOpen(false);
    setWorkingDirectory(powerShellWorkingDirectory(documentPath ?? ""));
  }, [documentPath, source]);
  useEffect(() => () => { runGeneration.current += 1; }, []);
  const copy = async (button: HTMLButtonElement) => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      emitCopyToast("success", "コードをコピーしました");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      emitCopyToast("error", "コードをコピーできませんでした");
    } finally {
      button.blur();
    }
  };

  const executable = Boolean(documentPath && rawLanguage && isPowerShellLanguage(rawLanguage));
  const execute = async () => {
    if (!documentPath || !rawLanguage || !executable || runInFlight.current) return;
    runInFlight.current = true;
    const generation = ++runGeneration.current;
    setConfirmationOpen(false);
    setRunning(true);
    setRunResult(null);
    setRunError(null);
    try {
      const result = await runPowerShell({ documentPath, language: rawLanguage, source, workingDirectory });
      if (runGeneration.current === generation) setRunResult(result);
    } catch (error) {
      if (runGeneration.current === generation) setRunError(String(error));
    } finally {
      if (runGeneration.current === generation) {
        runInFlight.current = false;
        setRunning(false);
      }
    }
  };

  return <div className="code-block">
    <div className="code-actions">
      {executable && <button type="button" className="code-run" disabled={running} onClick={() => {
        setWorkingDirectory(powerShellWorkingDirectory(documentPath ?? ""));
        setConfirmationOpen(true);
      }}>{running ? "実行中…" : "PowerShellを実行"}</button>}
      <button type="button" className="code-copy" onClick={(event) => void copy(event.currentTarget)}>{copied ? "Copied" : "Copy"}</button>
    </div>
    <pre><code className={className} {...(html ? { dangerouslySetInnerHTML: { __html: html } } : {})}>{html ? undefined : source}</code></pre>
    {(runResult || runError) && <section className="code-run-result" aria-label="PowerShell実行結果">
      <header><strong>{runError ? "実行エラー" : runResult?.timedOut ? "タイムアウト" : `終了コード: ${runResult?.exitCode ?? "不明"}`}</strong>{runResult && <span>{runResult.durationMs}ms{runResult.truncated ? "・出力省略" : ""}</span>}</header>
      {runResult?.stdout && <pre aria-label="標準出力">{runResult.stdout}</pre>}
      {runResult?.stderr && <pre className="code-run-result__stderr" aria-label="標準エラー">{runResult.stderr}</pre>}
      {runError && <pre className="code-run-result__stderr">{runError}</pre>}
    </section>}
    {confirmationOpen && <div className="code-run-confirmation-backdrop">
      <section className="code-run-confirmation" role="dialog" aria-modal="true" aria-labelledby="code-run-confirmation-title">
        <h2 id="code-run-confirmation-title">PowerShellコードを実行しますか？</h2>
        <p>このMarkdownに書かれたコードが、次のフォルダーで実行されます。内容を確認できる場合だけ続行してください。</p>
        <label className="code-run-confirmation__directory">作業フォルダー<input type="text" value={workingDirectory} onChange={(event) => setWorkingDirectory(event.target.value)} /></label>
        <dl><dt>実行環境</dt><dd>pwsh（PowerShell 7）</dd><dt>制限</dt><dd>非対話・30秒・出力1MiB</dd></dl>
        <pre>{source}</pre>
        <footer><button type="button" onClick={() => setConfirmationOpen(false)}>キャンセル</button><button type="button" className="code-run-confirmation__execute" onClick={() => void execute()}>実行する</button></footer>
      </section>
    </div>}
  </div>;
}

export function isPowerShellLanguage(language: string): boolean {
  return ["powershell", "pwsh", "ps1"].includes(language.trim().toLowerCase());
}

export function powerShellWorkingDirectory(documentPath: string): string {
  const separator = Math.max(documentPath.lastIndexOf("/"), documentPath.lastIndexOf("\\"));
  return separator > 0 ? documentPath.slice(0, separator) : documentPath;
}
