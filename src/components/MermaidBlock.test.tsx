import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  renderMermaid: vi.fn<(...args: [string, string, string]) => Promise<string>>(),
}));

vi.mock("../lib/mermaidService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/mermaidService")>()),
  renderMermaid: mocks.renderMermaid,
}));

import { MermaidBlock } from "./MermaidBlock";

afterEach(() => {
  cleanup();
  mocks.renderMermaid.mockReset();
});

describe("MermaidBlock", () => {
  it("discards an old asynchronous render after the source changes", async () => {
    let resolveFirst: (svg: string) => void = () => undefined;
    let resolveSecond: (svg: string) => void = () => undefined;
    mocks.renderMermaid
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const view = render(<MermaidBlock source="flowchart LR\nA --> B" theme="dark" mode="on" windowId="w" tabId="t" blockId="b" />);
    await waitFor(() => expect(mocks.renderMermaid).toHaveBeenCalledTimes(1));
    view.rerender(<MermaidBlock source="flowchart LR\nC --> D" theme="dark" mode="on" windowId="w" tabId="t" blockId="b" />);
    await waitFor(() => expect(mocks.renderMermaid).toHaveBeenCalledTimes(2));

    resolveFirst("<svg><text>old</text></svg>");
    resolveSecond("<svg><text>new</text></svg>");
    await waitFor(() => expect(screen.getByText("new")).toBeTruthy());
    expect(screen.queryByText("old")).toBeNull();
    expect(mocks.renderMermaid.mock.calls[0]?.[1]).toContain("w-t-b-g1");
    expect(mocks.renderMermaid.mock.calls[1]?.[1]).toContain("w-t-b-g2");
  });

  it("automatically exposes source code in error-code mode", async () => {
    mocks.renderMermaid.mockRejectedValueOnce(new Error("parse error"));
    render(<MermaidBlock source="sequenceDiagram\nAlice->>Bob: hello" theme="dark" mode="error-code" />);

    await waitFor(() => expect(screen.getByText("Mermaid を描画できません。")).toBeTruthy());
    expect(screen.getByText(/sequenceDiagram/)).toBeTruthy();
  });
});
