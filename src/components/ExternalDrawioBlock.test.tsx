import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { loadMarkdown, saveMarkdown } = vi.hoisted(() => ({
  loadMarkdown: vi.fn(),
  saveMarkdown: vi.fn(),
}));

vi.mock("../lib/commands", () => ({ loadMarkdown, saveMarkdown }));
vi.mock("./DrawioBlock", () => ({
  DrawioBlock: ({ source, onSave }: { source: string; onSave?: (content: string) => Promise<boolean | void> }) => (
    <button type="button" data-testid="external-drawio" data-editable={String(Boolean(onSave))} onClick={() => void onSave?.("<mxfile><diagram name=\"saved\"/></mxfile>")}>{source}</button>
  ),
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
    expect(screen.getByText("構成図")).toBeTruthy();
  });

  it("does not expose editing in a static preview", async () => {
    loadMarkdown.mockResolvedValue(loaded);
    render(<ExternalDrawioBlock source="diagrams/system.drawio" baseDir="C:\\docs" theme="dark" blockId="image-2" version={0} editable={false} />);
    expect((await screen.findByTestId("external-drawio")).dataset.editable).toBe("false");
  });

  it("shows a reload action when the referenced file cannot be loaded", async () => {
    loadMarkdown.mockRejectedValue(new Error("missing"));
    render(<ExternalDrawioBlock source="diagrams/missing.drawio" baseDir="C:\\docs" theme="dark" blockId="image-3" version={0} />);
    expect(await screen.findByText("missing")).toBeTruthy();
    expect(screen.getByRole("button", { name: "再読込" })).toBeTruthy();
  });
});
