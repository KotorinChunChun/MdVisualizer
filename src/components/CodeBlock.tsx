import { useEffect, useState } from "react";
import type { LanguageFn } from "highlight.js";

interface CodeBlockProps {
  className?: string;
  children?: React.ReactNode;
  /** Signals that highlight.js has finished replacing the code DOM. */
  onHighlightComplete?: () => void;
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

export function CodeBlock({ className, children, onHighlightComplete }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [html, setHtml] = useState("");
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

  return <div className="code-block"><button type="button" className="code-copy" onClick={(event) => void copy(event.currentTarget)}>{copied ? "Copied" : "Copy"}</button><pre><code className={className} {...(html ? { dangerouslySetInnerHTML: { __html: html } } : {})}>{html ? undefined : source}</code></pre></div>;
}
