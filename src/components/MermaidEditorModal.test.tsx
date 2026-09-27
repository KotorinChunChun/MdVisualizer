import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../generated/mermaidEditorDocument", () => ({ mermaidEditorDocument: "<!doctype html><title>editor</title>" }));

import { MermaidEditorModal } from "./MermaidEditorModal";

afterEach(cleanup);

describe("MermaidEditorModal", () => {
  it("accepts a current-source response only from its iframe with the issued nonce", async () => {
    const onApply = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    render(<MermaidEditorModal source="flowchart LR\nA --> B" onApply={onApply} onClose={onClose} />);
    const frame = screen.getByTitle("Mermaid GUI編集") as HTMLIFrameElement;
    const source = frame.contentWindow!;
    const postMessage = vi.spyOn(source, "postMessage");

    window.dispatchEvent(new MessageEvent("message", { source, data: { kind: "mdvisualizer-mermaid-ready" } }));
    await waitFor(() => expect((screen.getByRole("button", { name: "反映" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "反映" }));

    window.dispatchEvent(new MessageEvent("message", { source: window, data: { kind: "mdvisualizer-mermaid-current-source", nonce: "wrong", source: "bad" } }));
    expect(onApply).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent("message", { source, data: { kind: "mdvisualizer-mermaid-current-source", nonce: "wrong", source: "bad" } }));
    expect(onApply).not.toHaveBeenCalled();

    const request = postMessage.mock.calls.find((call: unknown[]) => ((call[0] as { kind?: string }).kind === "mdvisualizer-mermaid-request-current-source"))?.[0] as { nonce: string };
    window.dispatchEvent(new MessageEvent("message", { source, data: { kind: "mdvisualizer-mermaid-current-source", nonce: request.nonce, source: "flowchart LR\nX --> Y" } }));
    await Promise.resolve();
    expect(onApply).toHaveBeenCalledWith("flowchart LR\nX --> Y");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
