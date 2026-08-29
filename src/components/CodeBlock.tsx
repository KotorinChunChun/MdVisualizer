import { useEffect, useRef, useState } from "react";
import type { LanguageFn } from "highlight.js";
import { copyTextFile, runPowerShell, type PowerShellRunResult } from "../lib/commands";
import { ShortcutKeySvg } from "./ShortcutKeySvg";

interface CodeBlockProps {
  className?: string;
  children?: React.ReactNode;
  /** Signals that highlight.js has finished replacing the code DOM. */
  onHighlightComplete?: () => void;
  headingTitle?: string;
  documentPath?: string;
  storage?: "embedded" | "external";
  onStorageConvert?: () => boolean | void | Promise<boolean | void>;
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
  ps: "powershell", ps1: "powershell", pwsh: "powershell", py: "python", rs: "rust", sh: "bash",
  shell: "bash", ts: "typescript", tsx: "typescript", yml: "yaml",
};

function emitCopyToast(type: "success" | "error", message: string, actions?: Array<{ label: string; onAction: () => void | Promise<void> }>): void {
  window.dispatchEvent(new CustomEvent("markdown-toast", { detail: { type, message, actions } }));
}

const sourceExtensions: Record<string, string> = {
  bash: "sh", c: "c", cpp: "cpp", csharp: "cs", css: "css", go: "go", html: "html",
  java: "java", javascript: "js", json: "json", markdown: "md", powershell: "ps1",
  python: "py", rust: "rs", sql: "sql", typescript: "ts", xml: "xml", yaml: "yaml",
};

const languageNames: Record<string, string> = {
  bash: "Bash", c: "C", cpp: "C++", csharp: "C#", css: "CSS", go: "Go", html: "HTML",
  java: "Java", javascript: "JavaScript", json: "JSON", markdown: "Markdown", powershell: "PowerShell",
  python: "Python", rust: "Rust", sql: "SQL", typescript: "TypeScript", xml: "XML", yaml: "YAML",
};

export function syntaxHighlightLanguageName(language: string | undefined): string | undefined {
  if (!language) return undefined;
  const normalized = languageAliases[language.trim().toLowerCase()] ?? language.trim().toLowerCase();
  return normalized ? languageNames[normalized] ?? normalized : undefined;
}

export function CodeBlock({ className, children, onHighlightComplete, headingTitle, documentPath, storage, onStorageConvert }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [html, setHtml] = useState("");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<PowerShellRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [convertingStorage, setConvertingStorage] = useState(false);
  const runGeneration = useRef(0);
  const runInFlight = useRef(false);
  const rawLanguage = className?.match(/language-([\w-]+)/)?.[1]?.toLowerCase();
  const language = rawLanguage ? languageAliases[rawLanguage] ?? rawLanguage : undefined;
  const languageName = syntaxHighlightLanguageName(language);
  const normalizedHeadingTitle = headingTitle?.trim() || undefined;
  const source = String(children ?? "").replace(/\n$/, "");
  const shortcutKeyBlock = rawLanguage === "key";
  const copyCodeFile = async (extension: string, label: string) => {
    try {
      await copyTextFile({ filename: `code.${extension}`, content: source });
      emitCopyToast("success", `${label}をファイルとしてコピーしました`);
    } catch {
      emitCopyToast("error", `${label}をファイルとしてコピーできませんでした`);
    }
  };
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
  }, [documentPath, source]);
  useEffect(() => () => { runGeneration.current += 1; }, []);
  const copy = async (button: HTMLButtonElement) => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      const sourceExtension = sourceExtensions[language ?? ""] ?? rawLanguage?.replace(/[^a-z0-9]/g, "") ?? "txt";
      emitCopyToast("success", "コードをコピーしました", [
        { label: "TXTファイルでコピー", onAction: () => copyCodeFile("txt", "TXT") },
        { label: "ソースファイルとしてコピー", onAction: () => copyCodeFile(sourceExtension || "txt", "ソース") },
      ]);
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
      const result = await runPowerShell({ documentPath, language: rawLanguage, source });
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

  if (shortcutKeyBlock) {
    return <div className="code-block shortcut-key-block">
      <div className="code-actions">
        <button type="button" className="code-copy" onClick={(event) => void copy(event.currentTarget)}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <div className="shortcut-key-block__preview">
        <ShortcutKeySvg source={source} variant="block" />
      </div>
    </div>;
  }

  return <div className="code-block">
    {(languageName || normalizedHeadingTitle) && <div className="code-block__header">
      {languageName && <span className="code-block__language">{languageName}</span>}
      {normalizedHeadingTitle && <strong className="code-block__heading">{normalizedHeadingTitle}</strong>}
    </div>}
    <div className="code-actions">
      {storage && onStorageConvert && <button type="button" className="code-storage" disabled={convertingStorage} onClick={() => {
        setConvertingStorage(true);
        void Promise.resolve().then(onStorageConvert).catch((error) => emitCopyToast("error", error instanceof Error ? error.message : String(error))).finally(() => setConvertingStorage(false));
      }}>{convertingStorage ? "切替中…" : storage === "embedded" ? "外部ファイルへ切替" : "埋め込みへ切替"}</button>}
      {executable && <button type="button" className="code-run" disabled={running} onClick={() => {
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
        <p>このMarkdownに書かれたコードが、Markdownファイルと同じフォルダーへ移動してから実行されます。内容を確認できる場合だけ続行してください。</p>
        <label className="code-run-confirmation__directory">作業フォルダー<input type="text" value={powerShellWorkingDirectory(documentPath ?? "")} readOnly /></label>
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
  const normalizedPath = documentPath.startsWith("\\\\?\\UNC\\")
    ? `\\\\${documentPath.slice(8)}`
    : documentPath.startsWith("\\\\?\\")
      ? documentPath.slice(4)
      : documentPath;
  const separator = Math.max(normalizedPath.lastIndexOf("/"), normalizedPath.lastIndexOf("\\"));
  if (separator < 0) return normalizedPath;
  if (separator === 0) return normalizedPath.slice(0, 1);
  if (separator === 2 && /^[a-z]:[\\/]/i.test(normalizedPath)) return normalizedPath.slice(0, 3);
  return normalizedPath.slice(0, separator);
}
