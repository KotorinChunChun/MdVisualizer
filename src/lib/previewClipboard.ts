import { markdownForPreviewRange } from "./previewContext";

/** SVGの描画要素をコピーせず、キー列を一つの文字列として扱う。 */
export function previewPlainText(node: Node): string {
  const copy = node.cloneNode(true);
  if (copy instanceof Element || copy instanceof DocumentFragment) {
    copy.querySelectorAll("[data-shortcut-source]").forEach(element => element.replaceWith(document.createTextNode(element.getAttribute("data-shortcut-source")?.replace(/\s*\+\s*/g, " + ") ?? "")));
    copy.querySelectorAll("button, .fold-chevron, .preview-inline-editor").forEach(element => element.remove());
  }
  const block = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "TR", "BLOCKQUOTE", "PRE"]);
  function read(current: Node): string {
    if (current.nodeType === Node.TEXT_NODE) return current.textContent ?? "";
    if (current instanceof Element && current.tagName === "BR") return "\n";
    if (current instanceof Element && current.tagName === "IMG") return current.getAttribute("alt") ?? "";
    const value = [...current.childNodes].map(read).join("");
    return current instanceof Element && block.has(current.tagName) ? value.replace(/\n*$/, "") + "\n" : value;
  }
  return read(copy).trim();
}

export function previewClipboardData(root: HTMLElement, content: string, clicked?: Element | null) {
  const selection = window.getSelection();
  const inside = Boolean(selection && !selection.isCollapsed && selection.anchorNode && selection.focusNode && root.contains(selection.anchorNode) && root.contains(selection.focusNode));
  const lineAt = (node: Node | null) => Number((node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-source-line]")?.dataset.sourceLine) || 1;
  const lines = [...root.querySelectorAll<HTMLElement>("[data-source-line]")].map(node => Number(node.dataset.sourceLine)).filter(Number.isFinite);
  const first = inside ? lineAt(selection!.anchorNode) : lineAt(clicked ?? root);
  const last = inside ? lineAt(selection!.focusNode) : first;
  const range = inside ? selection!.getRangeAt(0).cloneRange() : null;
  if (range) {
    const shortcutAt = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest("[data-shortcut-source]");
    const start = shortcutAt(range.startContainer), end = shortcutAt(range.endContainer);
    if (start && root.contains(start)) range.setStartBefore(start);
    if (end && root.contains(end)) range.setEndAfter(end);
  }
  return {
    inside,
    plainText: previewPlainText(range ? range.cloneContents() : clicked?.closest("[data-source-line]") ?? root),
    markdownText: markdownForPreviewRange(content, lines, first, last),
  };
}

export function copyPreviewSelection(event: { target: EventTarget; currentTarget: EventTarget; clipboardData: DataTransfer; preventDefault(): void }, content: string) {
  if (!(event.currentTarget instanceof HTMLElement) || !(event.target instanceof Element) || event.target.closest("input, textarea, [contenteditable=true], .cm-editor, .table-editor-overlay")) return;
  const data = previewClipboardData(event.currentTarget, content);
  if (!data.inside) return;
  event.clipboardData.setData("text/plain", data.markdownText);
  event.preventDefault();
}
