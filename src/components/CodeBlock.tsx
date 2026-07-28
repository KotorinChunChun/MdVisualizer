import { useEffect, useState } from "react";

interface CodeBlockProps { className?: string; children?: React.ReactNode; }

export function CodeBlock({ className, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [html, setHtml] = useState("");
  const language = className?.match(/language-([\w-]+)/)?.[1];
  const source = String(children ?? "").replace(/\n$/, "");
  useEffect(() => {
    let cancelled = false;
    void import("highlight.js").then(({ default: hljs }) => {
      const highlighted = language && hljs.getLanguage(language) ? hljs.highlight(source, { language }).value : hljs.highlightAuto(source).value;
      if (!cancelled) setHtml(highlighted);
    }).catch(() => { if (!cancelled) setHtml(""); });
    return () => { cancelled = true; };
  }, [language, source]);
  const copy = async () => {
    await navigator.clipboard.writeText(source);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return <div className="code-block"><button type="button" className="code-copy" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button><pre><code className={className} {...(html ? { dangerouslySetInnerHTML: { __html: html } } : {})}>{html ? undefined : source}</code></pre></div>;
}
