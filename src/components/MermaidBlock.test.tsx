import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  renderMermaid: vi.fn<(...args: [string, string, string]) => Promise<string>>(),
  copyMermaid: vi.fn(),
  copyMermaidAsFile: vi.fn(),
}));

vi.mock("../lib/mermaidService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/mermaidService")>()),
  renderMermaid: mocks.renderMermaid,
}));

vi.mock("../lib/mermaidClipboard", () => ({
  copyMermaid: mocks.copyMermaid,
  copyMermaidAsFile: mocks.copyMermaidAsFile,
}));

import { MermaidBlock } from "./MermaidBlock";
import { BrowserCapabilitiesContext, desktopBrowserCapabilities } from "./BrowserCapabilities";

afterEach(() => {
  cleanup();
  mocks.renderMermaid.mockReset();
  mocks.copyMermaid.mockReset().mockResolvedValue(undefined);
  mocks.copyMermaidAsFile.mockReset().mockResolvedValue(undefined);
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
      headingTitle: "Mermaid図",
      diagramSource: "flowchart LR\nA --> B",
      diagramKind: "mermaid",
    });
  });

  it("copies the rendered diagram as BMP from the diagram context menu", async () => {
    mocks.renderMermaid.mockResolvedValueOnce('<svg viewBox="0 0 10 10"><rect width="10" height="10" /></svg>');
    render(<MermaidBlock source={"flowchart LR\nA --> B"} theme="dark" mode="on" />);
    const diagram = await screen.findByRole("button", { name: "図を拡大" });
    fireEvent.contextMenu(diagram);
    await waitFor(() => expect(mocks.copyMermaid).toHaveBeenCalledWith(
      "bmp",
      "flowchart LR\nA --> B",
      '<svg viewBox="0 0 10 10"><rect width="10" height="10" /></svg>',
    ));
  });

  it("keeps a render error compact and opens details in an isolated dialog", async () => {
    const longError = `Syntax Error in Text\n${"broken ".repeat(300)}`;
    mocks.renderMermaid.mockRejectedValueOnce(new Error(longError));
    const { container } = render(<MermaidBlock source="flowchart LR\nA - broken" theme="dark" mode="on" />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(container.querySelector(".mermaid-error pre")).toBeNull();
    expect(screen.queryByText(longError)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "エラー詳細" }));
    expect(screen.getByRole("dialog", { name: "Mermaidエラー詳細" }).textContent).toContain("Syntax Error in Text");
    fireEvent.click(screen.getByRole("button", { name: "エラー詳細を閉じる" }));
    expect(screen.queryByRole("dialog", { name: "Mermaidエラー詳細" })).toBeNull();
  });

  it("opens the Mermaid GUI editor from the header pencil", async () => {
    mocks.renderMermaid.mockResolvedValueOnce("<svg><text>diagram</text></svg>");
    render(<MermaidBlock source="flowchart LR\nA --> B" theme="dark" mode="on" headingTitle="処理フロー" editable />);

    const header = screen.getByRole("toolbar", { name: "Mermaidブロック操作" });
    expect(header.textContent).toContain("Mermaid — 処理フロー");
    expect(screen.getByRole("button", { name: "Mermaid GUI編集" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mermaid GUI編集" }));
    expect(screen.getByRole("dialog", { name: "Mermaid GUI編集" })).toBeTruthy();
    const titled = screen.getAllByTitle("Mermaid GUI編集");
    expect(titled[titled.length - 1]).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mermaid GUI編集を閉じる" }));
    expect(screen.queryByRole("dialog", { name: "Mermaid GUI編集" })).toBeNull();
  });

  it("switches a rendered block between diagram and source", async () => {
    mocks.renderMermaid.mockResolvedValueOnce('<svg><text>diagram</text></svg>');
    render(<MermaidBlock source={"flowchart LR\nA --> B"} theme="dark" mode="on" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "図を拡大" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "コピー▽" }));
    expect(screen.getByRole("menuitem", { name: "コードテキストをコピー" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "ベクターイメージとしてコピー" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "ビットマップイメージとしてコピー" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "SVGファイルとしてコピー" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "コード" }));
    expect(screen.getByText(/flowchart LR/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "図を拡大" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "プレビュー" }));
    expect(screen.getByRole("button", { name: "図を拡大" })).toBeTruthy();
  });

  it("keeps code copy available when Mermaid is configured as source-only", async () => {
    const source = "flowchart LR\nA --> B";
    render(<MermaidBlock source={source} theme="dark" mode="always-code" />);

    fireEvent.click(screen.getByRole("button", { name: "コピー▽" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "コードテキストをコピー" }));
    await waitFor(() => expect(mocks.copyMermaid).toHaveBeenCalledWith("code", source, ""));
    expect(screen.getByRole("toolbar", { name: "Mermaid操作" })).toBeTruthy();
  });

  it("browser-only host offers PNG through the bitmap menu without a native BMP context action", async () => {
    mocks.renderMermaid.mockResolvedValueOnce('<svg><text>diagram</text></svg>');
    render(<BrowserCapabilitiesContext.Provider value={{ ...desktopBrowserCapabilities, canCopyBitmap: false }}><MermaidBlock source="flowchart LR\nA --> B" theme="light" mode="on" /></BrowserCapabilitiesContext.Provider>);
    const diagram = await screen.findByRole("button", { name: "図を拡大" });
    fireEvent.click(screen.getByRole("button", { name: "コピー▽" }));
    expect((screen.getByRole("menuitem", { name: "ビットマップイメージとしてコピー" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.contextMenu(diagram);
    expect(mocks.copyMermaid).not.toHaveBeenCalled();
  });
});
