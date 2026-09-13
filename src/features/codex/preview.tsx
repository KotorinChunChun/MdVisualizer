import { MarkdownPreview } from "../../components/MarkdownPreview";
import { validateDiagramReplacement, type CodexDiagramKind } from "./diagram";
import { svgToPngBlob } from "../../lib/mermaidClipboard";
import { renderMermaid } from "../../lib/mermaidService";

export function CodexMarkdownPreview({ source, baseDir = "" }: { source: string; baseDir?: string }) {
  return <MarkdownPreview content={source} baseDir={baseDir} imageVersions={{}} theme="light" mermaidMode="on" foldState={{}} onFoldChange={() => {}} />;
}
export async function diagramImage(source: string, kind?: CodexDiagramKind, renderedSvg?: string): Promise<{ base64: string; mime: string }> {
  let svg = renderedSvg;
  if (!svg && kind === "svg") svg = validateDiagramReplacement("svg", source);
  if (!svg && kind === "mermaid") svg = await renderMermaid(source, `codex-${crypto.randomUUID()}`, "light");
  if (!svg) throw new Error("図のプレビューが完了してから操作してください。");
  const blob = await svgToPngBlob(svg);
  return await blobImage(blob);
}
export function blobImage(blob: Blob): Promise<{ base64: string; mime: string }> {
  if (blob.size > 10 * 1024 * 1024) return Promise.reject(new Error("画像は10MB以下にしてください。"));
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("画像を読み込めません。")); reader.onload = () => resolve({ base64: String(reader.result).split(",")[1], mime: blob.type || "image/png" }); reader.readAsDataURL(blob); });
}
