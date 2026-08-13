// @ts-nocheck -- This suite also verifies source wiring without shipping Node typings.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canEditMarkdownDocument, documentLinkTarget, focusAndSelectSearchInput, handleWindowCloseRequest, moveZoomLevel, normalizeZoom, resolveDocumentPanelForView, resolveDocumentSidePanel, tocHeadingIdAtPointer, ZOOM_LEVELS } from "./App";

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
