import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAWIO_ORIGIN } from "../lib/drawio";
import { replaceCodeFenceBody, type CodeFenceOccurrence } from "../lib/markdownOccurrences";
import type { MarkdownLoadResult } from "../types/app";

const commandMocks = vi.hoisted(() => ({
  loadMarkdown: vi.fn(),
  saveMarkdown: vi.fn(),
}));

vi.mock("../lib/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/commands")>()),
  loadMarkdown: commandMocks.loadMarkdown,
  saveMarkdown: commandMocks.saveMarkdown,
}));

import { MarkdownPreview } from "./MarkdownPreview";
import { StandaloneDocumentPreview } from "./StandaloneDocumentPreview";

const initialXml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="before" vertex="1" parent="1"/></root></mxGraphModel>';
const editedXml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="after" vertex="1" parent="1"/></root></mxGraphModel>';

function editorFrame(): HTMLIFrameElement {
  return screen.getByTitle("draw.io editor") as HTMLIFrameElement;
}

function sendEditorMessage(frame: HTMLIFrameElement, data: unknown) {
  fireEvent(window, new MessageEvent("message", {
    origin: DRAWIO_ORIGIN,
    source: frame.contentWindow,
    data: JSON.stringify(data),
  }));
}

function EmbeddedDrawioHarness() {
  const [markdown, setMarkdown] = useState(`# 構成\n\n\`\`\`drawio title="構成図"\n${initialXml}\n\`\`\``);
  const save = (occurrence: CodeFenceOccurrence, body: string) => {
    try {
      setMarkdown(replaceCodeFenceBody(markdown, occurrence, body));
      return true;
    } catch {
      return false;
    }
  };
  return <>
    <output data-testid="markdown-draft">{markdown}</output>
    <MarkdownPreview
      content={markdown}
      baseDir="C:\\docs"
      documentPath="C:\\docs\\note.md"
      imageVersions={{}}
      onCodeFenceBodyChange={save}
    />
  </>;
}

function drawioDocument(content = initialXml, revision = "revision-1"): MarkdownLoadResult {
  return {
    path: "C:\\docs\\diagram.drawio",
    kind: "drawio",
    content,
    base_dir: "C:\\docs",
    image_paths: [],
    encoding: "UTF-8",
    size_bytes: content.length,
    modified_at: "2026-08-30 00:00",
    revision,
  };
}

describe("draw.io View editing flow", () => {
  beforeEach(() => {
    commandMocks.loadMarkdown.mockReset();
    commandMocks.saveMarkdown.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("updates an embedded Markdown fence through the trusted draw.io protocol without GUI automation", async () => {
    render(<EmbeddedDrawioHarness />);

    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    const frame = editorFrame();
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    sendEditorMessage(frame, { event: "init" });

    expect(postMessage).toHaveBeenCalledWith(expect.stringContaining('"action":"load"'), DRAWIO_ORIGIN);
    expect(postMessage).toHaveBeenCalledWith(expect.stringContaining("before"), DRAWIO_ORIGIN);

    sendEditorMessage(frame, { event: "save", xml: `<mxfile><diagram>${editedXml}</diagram></mxfile>`, exit: true });

    await waitFor(() => expect(screen.getByTestId("markdown-draft").textContent).toContain('value="after"'));
    expect(screen.getByTestId("markdown-draft").textContent).not.toContain('value="before"');
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "draw.io図の編集" })).toBeNull());
  });

  it("loads and saves an external draw.io reference through the same View editing flow", async () => {
    const loaded = drawioDocument();
    commandMocks.loadMarkdown.mockResolvedValue(loaded);
    commandMocks.saveMarkdown.mockResolvedValue({ status: "saved", document: drawioDocument(editedXml, "revision-2") });
    render(<MarkdownPreview
      content="![構成図](diagram.drawio)"
      baseDir="C:\\docs"
      documentPath="C:\\docs\\note.md"
      imageVersions={{}}
    />);

    fireEvent.click(await screen.findByRole("button", { name: "編集" }));
    const frame = editorFrame();
    sendEditorMessage(frame, { event: "init" });
    sendEditorMessage(frame, { event: "save", xml: `<mxfile><diagram>${editedXml}</diagram></mxfile>`, exit: true });

    await waitFor(() => expect(commandMocks.saveMarkdown).toHaveBeenCalledWith({
      path: loaded.path,
      content: editedXml,
      expectedRevision: "revision-1",
      stagedAssetIds: [],
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "draw.io図の編集" })).toBeNull());
  });

  it("keeps the editor open and reports a revision conflict for an external draw.io file", async () => {
    const loaded = drawioDocument();
    commandMocks.loadMarkdown.mockResolvedValue(loaded);
    commandMocks.saveMarkdown.mockResolvedValue({ status: "conflict", latest: drawioDocument(initialXml, "revision-2") });
    render(<MarkdownPreview
      content="![](diagram.drawio)"
      baseDir="C:\\docs"
      documentPath="C:\\docs\\note.md"
      imageVersions={{}}
    />);

    fireEvent.click(await screen.findByRole("button", { name: "編集" }));
    const frame = editorFrame();
    sendEditorMessage(frame, { event: "init" });
    sendEditorMessage(frame, { event: "save", xml: `<mxfile><diagram>${editedXml}</diagram></mxfile>`, exit: true });

    expect((await screen.findByRole("alert")).textContent).toContain("参照先のdraw.ioファイルが更新されています");
    expect(screen.getByRole("dialog", { name: "draw.io図の編集" })).toBeTruthy();
  });

  it("routes a directly opened .drawio file from View to its save callback", async () => {
    function StandaloneHarness() {
      const [document, setDocument] = useState(drawioDocument());
      return <>
        <output data-testid="standalone-source">{document.content}</output>
        <StandaloneDocumentPreview
          document={document}
          imageVersions={{}}
          theme="light"
          windowId="main"
          tabId="tab-drawio"
          onDrawioSave={(content) => {
            setDocument((current) => ({ ...current, content, revision: "revision-2" }));
            return true;
          }}
        />
      </>;
    }

    render(<StandaloneHarness />);
    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    const frame = editorFrame();
    sendEditorMessage(frame, { event: "init" });
    sendEditorMessage(frame, { event: "save", xml: `<mxfile><diagram>${editedXml}</diagram></mxfile>`, exit: true });

    await waitFor(() => expect(screen.getByTestId("standalone-source").textContent).toContain('value="after"'));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "draw.io図の編集" })).toBeNull());
  });
});
