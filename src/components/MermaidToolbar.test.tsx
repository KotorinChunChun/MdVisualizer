import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  copyMermaid: vi.fn(),
  copyMermaidAsFile: vi.fn(),
}));

vi.mock("../lib/mermaidClipboard", () => ({
  copyMermaid: mocks.copyMermaid,
  copyMermaidAsFile: mocks.copyMermaidAsFile,
}));

import { MermaidToolbar } from "./MermaidToolbar";

afterEach(() => {
  cleanup();
  mocks.copyMermaid.mockReset().mockResolvedValue(undefined);
  mocks.copyMermaidAsFile.mockReset().mockResolvedValue("C:/temp/drawio.drawio");
});

describe("MermaidToolbar", () => {
  it("offers draw.io copies as files from the success toast", async () => {
    let toastDetail: { actionLabel?: string; onAction?: () => Promise<void> } | undefined;
    const listener = (event: Event) => { toastDetail = (event as CustomEvent).detail; };
    window.addEventListener("markdown-toast", listener);
    render(<MermaidToolbar
      source="<mxfile/>"
      svg='<svg viewBox="0 0 10 10"/>'
      display="diagram"
      fileDiagramKind="drawio"
    />);

    fireEvent.click(screen.getByRole("button", { name: "コードをコピー" }));
    await waitFor(() => expect(toastDetail?.actionLabel).toBe("ファイルとしてコピー"));
    await toastDetail?.onAction?.();

    expect(mocks.copyMermaidAsFile).toHaveBeenCalledWith(
      "code",
      "<mxfile/>",
      '<svg viewBox="0 0 10 10"/>',
      "drawio",
    );
    window.removeEventListener("markdown-toast", listener);
  });
});
