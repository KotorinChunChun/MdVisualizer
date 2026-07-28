import { useMemo, useState } from "react";
import hljs from "highlight.js";

interface CodeBlockProps { className?: string; children?: React.ReactNode; }

export function CodeBlock({ className, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const language = className?.match(/language-([\w-]+)/)?.[1];
  const source = String(children ?? "").replace(/\n$/, "");
  const html = useMemo(() => {
    if (language && hljs.getLanguage(language)) return hljs.highlight(source, { language }).value;
    return hljs.highlightAuto(source).value;
  }, [language, source]);
  const copy = async () => {
    await navigator.clipboard.writeText(source);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return <div className="code-block"><button type="button" className="code-copy" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button><pre><code className={className} dangerouslySetInnerHTML={{ __html: html }} /></pre></div>;
}
