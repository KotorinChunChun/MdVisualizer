import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { loadMarkdown, saveMarkdown } = vi.hoisted(() => ({
  loadMarkdown: vi.fn(),
  saveMarkdown: vi.fn(),
}));

vi.mock("../lib/commands", () => ({ loadMarkdown, saveMarkdown }));
vi.mock("./DrawioBlock", () => ({
  DrawioBlock: ({ source, headingTitle, description, onSave, onStorageConvert }: { source: string; headingTitle?: string; description?: string; onSave?: (content: string) => Promise<boolean | void>; onStorageConvert?: () => void }) => <div>
    <button type="button" data-testid="external-drawio" data-title={headingTitle} data-description={description} data-editable={String(Boolean(onSave))} onClick={() => void onSave?.("<mxfile><diagram name=\"saved\"/></mxfile>")}>{source}</button>
    {onStorageConvert && <button type="button" onClick={onStorageConvert}>埋め込みへ切替</button>}
  </div>,
}));

import { ExternalDrawioBlock } from "./ExternalDrawioBlock";

const loaded = {
  path: "C:\\docs\\diagrams\\system.drawio",
  kind: "drawio" as const,
  content: "<mxfile><diagram name=\"initial\"/></mxfile>",
  base_dir: "C:\\docs\\diagrams",
  image_paths: [],
  encoding: "UTF-8",
  size_bytes: 50,
  modified_at: "2026-08-24 23:00",
  revision: "revision-1",
};

describe("ExternalDrawioBlock", () => {
  afterEach(() => {
    cleanup();
    loadMarkdown.mockReset();
    saveMarkdown.mockReset();
  });

  it("loads a referenced draw.io file and saves edits to that file", async () => {
    loadMarkdown.mockResolvedValue(loaded);
    saveMarkdown.mockResolvedValue({ status: "saved", document: { ...loaded, content: "<mxfile><diagram name=\"saved\"/></mxfile>", revision: "revision-2" } });
    render(<ExternalDrawioBlock source="diagrams/system.drawio" alt="構成図" baseDir="C:\\docs" theme="dark" blockId="image-1" version={0} />);

    expect((await screen.findByTestId("external-drawio")).textContent).toContain("initial");
    expect(loadMarkdown).toHaveBeenCalledWith("C:/docs/diagrams/system.drawio");
    fireEvent.click(screen.getByTestId("external-drawio"));

    await waitFor(() => expect(saveMarkdown).toHaveBeenCalledWith({
      path: loaded.path,
      content: "<mxfile><diagram name=\"saved\"/></mxfile>",
      expectedRevision: "revision-1",
      stagedAssetIds: [],
    }));
    expect(screen.getByTestId("external-drawio").dataset.title).toBe("system.drawio");
    expect(screen.getByTestId("external-drawio").dataset.description).toBe("構成図");
  });

  it("does not expose editing in a static preview", async () => {
    loadMarkdown.mockResolvedValue(loaded);
    render(<ExternalDrawioBlock source="diagrams/system.drawio" baseDir="C:\\docs" theme="dark" blockId="image-2" version={0} editable={false} />);
    expect((await screen.findByTestId("external-drawio")).dataset.editable).toBe("false");
    expect(screen.getByTestId("external-drawio").dataset.title).toBe("system.drawio");
  });

  it("shows a reload action when the referenced file cannot be loaded", async () => {
    loadMarkdown.mockRejectedValue(new Error("missing"));
    render(<ExternalDrawioBlock source="diagrams/missing.drawio" baseDir="C:\\docs" theme="dark" blockId="image-3" version={0} />);
    expect(await screen.findByText("missing")).toBeTruthy();
    expect(screen.getByRole("button", { name: "再読込" })).toBeTruthy();
  });

  it("uses staged draw.io XML immediately and can switch it back to embedded storage", async () => {
    const onStorageConvert = vi.fn();
    const onStagedSourceChange = vi.fn(() => true);
    const stagedSource = "<mxfile><diagram name=\"staged\"/></mxfile>";
    render(<ExternalDrawioBlock
      source="diagram.drawio"
      baseDir="C:\\docs"
      theme="dark"
      blockId="image-4"
      version={0}
      stagedSource={stagedSource}
      onStorageConvert={onStorageConvert}
      onStagedSourceChange={onStagedSourceChange}
    />);

    expect((await screen.findByTestId("external-drawio")).textContent).toContain("staged");
    expect(loadMarkdown).not.toHaveBeenCalled();
    expect(screen.getByTestId("external-drawio").dataset.editable).toBe("true");
    fireEvent.click(screen.getByTestId("external-drawio"));
    expect(onStagedSourceChange).toHaveBeenCalledWith("<mxfile><diagram name=\"saved\"/></mxfile>");
    fireEvent.click(screen.getByRole("button", { name: "埋め込みへ切替" }));
    expect(onStorageConvert).toHaveBeenCalledWith(stagedSource, undefined);
  });
});
