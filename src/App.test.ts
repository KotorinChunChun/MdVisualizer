// @ts-nocheck -- This suite also verifies source wiring without shipping Node typings.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { applicationWindowTitle, canEditMarkdownDocument, documentLinkTarget, focusAndSelectSearchInput, handleWindowCloseRequest, hasPreviewTextSelection, moveZoomLevel, normalizeZoom, previewSelectionSourceRange, resolveDocumentPanelForView, resolveDocumentSidePanel, shouldBlockF5Reload, tocHeadingIdAtPointer, ZOOM_LEVELS } from "./App";

describe("application window title", () => {
  it("uses the active tab filename followed by the application name", () => {
    expect(applicationWindowTitle({ path: "C:\\docs\\sample.md" })).toBe("sample.md - MarkdownViewer");
    expect(applicationWindowTitle({ kind: "settings", path: "__settings__" })).toBe("設定 - MarkdownViewer");
    expect(applicationWindowTitle(null)).toBe("MarkdownViewer");
  });
});

describe("new Markdown shortcut wiring", () => {
  it("maps Ctrl+N to the untitled Markdown reducer action", () => {
    const source = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    expect(source).toContain('event.key.toLowerCase() === "n"');
    expect(source).toContain('dispatch({ type: "NEW_MARKDOWN" })');
  });
});

describe("F5 reload protection", () => {
  it("blocks F5 for an unsaved document and permits a saved document", () => {
    expect(shouldBlockF5Reload({ dirty: true })).toBe(true);
    expect(shouldBlockF5Reload({ dirty: false })).toBe(false);
    expect(shouldBlockF5Reload(null)).toBe(false);
  });

  it("handles F5 before modal early returns and warns instead of confirming discard", () => {
    const source = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    const f5 = source.indexOf('if (event.key === "F5")');
    const modalReturn = source.indexOf("if (annotationTarget) return", f5);
    expect(f5).toBeGreaterThan(-1);
    expect(modalReturn).toBeGreaterThan(f5);
    expect(source).toContain("未保存の編集内容があるため再読み込みを中止しました");
    expect(source.slice(f5, modalReturn)).toContain("event.preventDefault()");
    expect(source.slice(f5, modalReturn)).toContain("shouldBlockF5Reload(activeTab)");
  });
});

describe("save conflict wiring", () => {
  it("opens a typed conflict result in DIFF and retries against the reviewed revision", () => {
    const source = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    expect(source).toContain('result.status === "conflict"');
    expect(source).toContain("storageRevision: result.latest.revision");
    expect(source).toContain("saveTab(activeTab.id, documentDiff.storageRevision)");
  });
});

describe("Edit and View pane coordination", () => {
  it("connects source-line focus, current-line highlighting, the View menu, and the EV focus shortcut", () => {
    const source = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    expect(source).toContain("onClickCapture={handlePreviewClick}");
    expect(source).toContain("onContextMenu={handlePreviewContextMenu}");
    expect(source).toContain("onScrollLine={editorMode === \"split\" ? handleEditorScrollLine : undefined}");
    expect(source).toContain("onActiveLineChange={editorMode === \"split\" ? setActiveEditorLine : undefined}");
    expect(source).toContain("onCursorPositionChange={editorMode === \"split\" ? handleEditorCursorPosition : undefined}");
    expect(source).toContain("hasPreviewTextSelection(window.getSelection(), markdownRef.current)");
    expect(source).toContain('if (editorMode === "preview") return;');
    expect(source).toContain("<PreviewContextMenu");
    expect(source).toContain('event.ctrlKey && event.shiftKey');
    expect(source).toContain('editorMode === "split"');
  });

  it("maps a complete View selection to the complete Markdown source range", () => {
    const root = document.createElement("div");
    root.innerHTML = '<p data-source-line="1">first</p><p data-source-line="3">last</p>';
    document.body.append(root);
    const range = document.createRange();
    range.selectNodeContents(root);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(previewSelectionSourceRange(selection, root, [1, 3], 1)).toEqual({ inside: true, firstLine: 1, lastLine: 3 });
    root.remove();
  });

  it("keeps a non-empty text selection inside View owned by the browser", () => {
    const root = document.createElement("div");
    const paragraph = document.createElement("p");
    paragraph.textContent = "copy this text";
    root.append(paragraph);
    document.body.append(root);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(hasPreviewTextSelection(selection, root)).toBe(true);
    expect(hasPreviewTextSelection(selection, document.createElement("div"))).toBe(false);

    selection?.collapse(paragraph.firstChild, 0);
    expect(hasPreviewTextSelection(selection, root)).toBe(false);
    selection?.removeAllRanges();
    root.remove();
  });
});

describe("extended navigation history wiring", () => {
  it("captures and restores pane, semantic scroll, and media preview state", () => {
    const source = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    expect(source).toContain("scrollAnchor: containerRef.current && markdownRef.current ? captureScrollAnchor");
    expect(source).toContain("mediaPreview: mediaPreviewRef.current");
    expect(source).toContain("if (snapshot.editorMode) dispatch");
    expect(source).toContain("setMediaPreview(snapshot.mediaPreview)");
  });
});

describe("Markdown editing availability", () => {
  it("enables editing for both local and SharePoint Markdown documents", () => {
    expect(canEditMarkdownDocument({ kind: "markdown" })).toBe(true);
    expect(canEditMarkdownDocument({ kind: "svg" })).toBe(false);
    expect(canEditMarkdownDocument(null)).toBe(false);
  });
});

describe("window close protection", () => {
  it("destroys an unmodified window without asking", async () => {
    const confirmDiscard = vi.fn(() => false);
    const preventDefault = vi.fn();
    const destroyWindow = vi.fn(async () => {});

    await handleWindowCloseRequest(false, confirmDiscard, { preventDefault }, destroyWindow);

    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(destroyWindow).toHaveBeenCalledOnce();
  });

  it("destroys a modified window after discard is confirmed", async () => {
    const confirmDiscard = vi.fn(() => true);
    const preventDefault = vi.fn();
    const destroyWindow = vi.fn(async () => {});

    await handleWindowCloseRequest(true, confirmDiscard, { preventDefault }, destroyWindow);

    expect(confirmDiscard).toHaveBeenCalledWith("未保存の編集内容があります。破棄してアプリを終了しますか？");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(destroyWindow).toHaveBeenCalledOnce();
  });

  it("keeps a modified window open when discard is rejected", async () => {
    const confirmDiscard = vi.fn(() => false);
    const preventDefault = vi.fn();
    const destroyWindow = vi.fn(async () => {});

    await handleWindowCloseRequest(true, confirmDiscard, { preventDefault }, destroyWindow);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(destroyWindow).not.toHaveBeenCalled();
  });
});

describe("zoom level selection", () => {
  it("normalizes persisted values to a selectable status-bar option", () => {
    expect(normalizeZoom(77)).toBe(80);
    expect(normalizeZoom(210)).toBe(200);
    expect(normalizeZoom(40)).toBe(50);
  });

  it("moves shortcuts through the fixed option list without producing gaps", () => {
    expect(moveZoomLevel(70, 1)).toBe(80);
    expect(moveZoomLevel(80, -1)).toBe(70);
    expect(moveZoomLevel(50, -1)).toBe(50);
    expect(moveZoomLevel(200, 1)).toBe(200);
    expect(ZOOM_LEVELS).toContain(moveZoomLevel(100, 1));
  });
});

describe("search input focus", () => {
  it("focuses the search box and selects the complete existing query", () => {
    const input = document.createElement("input");
    input.value = "cargo";
    const select = vi.spyOn(input, "select");
    document.body.append(input);

    focusAndSelectSearchInput(input);

    expect(document.activeElement).toBe(input);
    expect(select).toHaveBeenCalledOnce();
    input.remove();
  });
});

describe("document link focus", () => {
  it("returns the authored href only for links inside the Markdown body", () => {
    const body = document.createElement("div");
    body.className = "markdown-body";
    body.innerHTML = '<a href="../guide/next.md"><span>next</span></a>';
    const nested = body.querySelector("span");
    const outside = document.createElement("a");
    outside.href = "https://example.com";

    expect(documentLinkTarget(nested)).toBe("../guide/next.md");
    expect(documentLinkTarget(outside)).toBeNull();
    expect(documentLinkTarget(null)).toBeNull();
  });
});

describe("TOC pointer focus", () => {
  it("returns a fold id only while the pointer target is inside that section's heading", () => {
    const root = document.createElement("div");
    root.innerHTML = '<section data-fold-id="first"><h2><button><span>First</span></button></h2><div><p>Between headings</p></div></section><section data-fold-id="second"><h2>Second</h2></section>';
    const headingText = root.querySelector("h2 span");
    const betweenHeadings = root.querySelector("p");
    const outside = document.createElement("h2");

    expect(tocHeadingIdAtPointer(headingText, root)).toBe("first");
    expect(tocHeadingIdAtPointer(betweenHeadings, root)).toBeNull();
    expect(tocHeadingIdAtPointer(outside, root)).toBeNull();
    expect(tocHeadingIdAtPointer(null, root)).toBeNull();
  });

  it("uses the pointer event target and clears focus when leaving the preview", () => {
    const source = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    expect(source).toContain("const target = event.target instanceof Element ? event.target : null;");
    expect(source).not.toContain("document.elementFromPoint(event.clientX, event.clientY)");
    expect(source).toContain("onPointerLeave={handlePreviewPointerLeave}");
    expect(source).toContain("setActiveTocHeadingId(null);");
  });
});

describe("document side panel ownership", () => {
  it("gives search results priority without discarding the requested TOC state", () => {
    expect(resolveDocumentSidePanel(true, "toc")).toBe("search");
    expect(resolveDocumentSidePanel(false, "toc")).toBe("toc");
    expect(resolveDocumentSidePanel(false, "images")).toBe("images");
    expect(resolveDocumentSidePanel(false, null)).toBeNull();
  });

  it("keeps the shared TOC available in presentation mode while hiding only images", () => {
    expect(resolveDocumentPanelForView("presentation", "toc")).toBe("toc");
    expect(resolveDocumentPanelForView("presentation", "images")).toBeNull();
    expect(resolveDocumentPanelForView("auto", "images")).toBe("images");
  });
});
