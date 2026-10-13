import type { DocumentSidePanelTab } from "../components/DocumentSidePanel";
import type { ViewMode } from "./viewMode";

export function resolveDocumentSidePanel(searchOpen: boolean, requestedPanel: Exclude<DocumentSidePanelTab, "search"> | null): DocumentSidePanelTab | null {
  if (searchOpen) return "search";
  return requestedPanel;
}

export function resolveDocumentPanelForView(viewMode: ViewMode, requestedPanel: Exclude<DocumentSidePanelTab, "search"> | null): Exclude<DocumentSidePanelTab, "search"> | null {
  return viewMode === "presentation" && requestedPanel === "images" ? null : requestedPanel;
}

export function canEditMarkdownDocument(document: { kind: string } | null | undefined): boolean {
  return document?.kind === "markdown" || document?.kind === "tsv";
}

export function shouldBlockF5Reload(tab: { dirty: boolean } | null | undefined): boolean {
  return Boolean(tab?.dirty);
}

export function applicationWindowTitle(tab: { kind?: "document" | "settings"; path: string } | null | undefined): string {
  if (!tab) return "MdVisualizer";
  if (tab.kind === "settings") return "設定 - MdVisualizer";
  const segments = tab.path.split(/[\\/]/).filter(Boolean);
  const filename = segments[segments.length - 1] ?? tab.path;
  return `${filename} - MdVisualizer`;
}
