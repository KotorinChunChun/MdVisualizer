import type { CodeFenceOccurrence, ImageMarkdownOccurrence } from "./markdownOccurrences";

export type TextStorageConversionContext =
  | { documentPath: string; storage: "embedded"; occurrence: CodeFenceOccurrence; source: string; language: string; relativePath?: string }
  | { documentPath: string; storage: "external"; occurrence: ImageMarkdownOccurrence; source: string; language: string };

const extensions: Record<string, string> = {
  bash: "sh", shell: "sh", csharp: "cs", cs: "cs", javascript: "js", js: "js", jsx: "jsx",
  markdown: "md", powershell: "ps1", python: "py", rust: "rs", typescript: "ts", ts: "ts", tsx: "tsx",
  yaml: "yaml", yml: "yml", xml: "xml", html: "html", css: "css", json: "json", sql: "sql",
};

export function sourceExtensionForLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  return extensions[normalized] ?? (normalized.replace(/[^a-z0-9]/g, "") || "txt");
}

export function textExternalReference(source: string): string {
  const destination = /[\s()]/.test(source) ? `<${source}>` : source;
  const filename = source.replace(/\\/g, "/").split("/").pop() || "外部テキスト";
  return `![${filename}](${destination})`;
}
