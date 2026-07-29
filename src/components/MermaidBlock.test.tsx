import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("sends the rendered SVG to the shared fit preview", async () => {
    mocks.renderMermaid.mockResolvedValueOnce('<svg viewBox="0 0 800 400"><text>diagram</text></svg>');
    const onMediaOpen = vi.fn();
    render(<MermaidBlock source={"flowchart LR\nA --> B"} theme="dark" mode="on" onMediaOpen={onMediaOpen} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "図を拡大" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "図を拡大" }));
    expect(onMediaOpen).toHaveBeenCalledWith({
      content: {
        kind: "svg",
        svg: '<svg viewBox="0 0 800 400"><text>diagram</text></svg>',
        alt: "Mermaid図",
      },
      mermaidSource: "flowchart LR\nA --> B",
    });
  });

  it("switches a rendered block between diagram and source", async () => {
    mocks.renderMermaid.mockResolvedValueOnce('<svg><text>diagram</text></svg>');
    render(<MermaidBlock source={"flowchart LR\nA --> B"} theme="dark" mode="on" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "図を拡大" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "コード" }));
    expect(screen.getByText(/flowchart LR/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "図を拡大" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "図" }));
    expect(screen.getByRole("button", { name: "図を拡大" })).toBeTruthy();
  });
});
