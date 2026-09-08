import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { loadMarkdown } = vi.hoisted(() => ({ loadMarkdown: vi.fn() }));
vi.mock("../lib/commands", () => ({ loadMarkdown }));
vi.mock("./MermaidBlock", () => ({
  MermaidBlock: ({ source, headingTitle, description, storage, editable, onStorageConvert }: { source: string; headingTitle?: string; description?: string; storage?: string; editable?: boolean; onStorageConvert?: () => void }) => <div>
    <output data-testid="external-mermaid" data-title={headingTitle} data-description={description} data-storage={storage} data-editable={String(editable)}>{source}</output>
    {onStorageConvert && <button type="button" onClick={onStorageConvert}>埋め込みへ切替</button>}
  </div>,
}));

import { ExternalMermaidBlock } from "./ExternalMermaidBlock";

describe("ExternalMermaidBlock", () => {
  afterEach(() => { cleanup(); loadMarkdown.mockReset(); });

  it("loads an external mmd file and offers one-click embedding", async () => {
    loadMarkdown.mockResolvedValue({ kind: "mermaid", content: "flowchart LR\nA --> B" });
    const onStorageConvert = vi.fn();
    render(<ExternalMermaidBlock source="flow.mmd" alt="処理フロー" baseDir="C:\\docs" theme="dark" blockId="mmd-1" version={0} onStorageConvert={onStorageConvert} />);

    expect((await screen.findByTestId("external-mermaid")).textContent).toContain("A --> B");
    expect(loadMarkdown).toHaveBeenCalledWith("C:/docs/flow.mmd");
    fireEvent.click(screen.getByRole("button", { name: "埋め込みへ切替" }));
    expect(onStorageConvert).toHaveBeenCalledWith("flowchart LR\nA --> B", "処理フロー");
    expect(screen.getByTestId("external-mermaid").dataset.title).toBe("flow.mmd");
    expect(screen.getByTestId("external-mermaid").dataset.description).toBe("処理フロー");
  });

  it("renders staged Mermaid source without touching the filesystem", async () => {
    render(<ExternalMermaidBlock source="flow.mmd" baseDir="C:\\docs" theme="dark" blockId="mmd-2" version={0} stagedSource="sequenceDiagram\nA->>B: staged" />);
    expect((await screen.findByTestId("external-mermaid")).textContent).toContain("staged");
    expect(screen.getByTestId("external-mermaid").dataset.title).toBe("flow.mmd");
    expect(loadMarkdown).not.toHaveBeenCalled();
  });

  it("shows a retry action for an invalid referenced file", async () => {
    loadMarkdown.mockRejectedValue(new Error("missing"));
    render(<ExternalMermaidBlock source="missing.mmd" baseDir="C:\\docs" theme="dark" blockId="mmd-3" version={0} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "再読込" }));
    await waitFor(() => expect(loadMarkdown).toHaveBeenCalledTimes(2));
  });
});
