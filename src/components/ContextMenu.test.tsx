import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";
import { openContainingFolder } from "../lib/commands";

vi.mock("../lib/commands", () => ({ openContainingFolder: vi.fn(), openExternalUrl: vi.fn(), openInEditor: vi.fn() }));

const tab = { id: "tab-1", path: "C:\\docs\\sample.md", document: null, error: null, loading: false, scrollTop: 0, generation: 1, draft: "", dirty: false, saving: false, saveError: null, editorMode: "preview" as const, imageDisplaySizes: {}, search: { query: "", regex: false, caseSensitive: false, activeIndex: -1 } };

afterEach(cleanup);

describe("ContextMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("dismisses when focus leaves the menu", () => {
    const onDismiss = vi.fn();
    render(<ContextMenu tab={tab} x={0} y={0} onDismiss={onDismiss} onClose={() => {}} onCloseOthers={() => {}} onCloseRight={() => {}} onNewWindow={() => {}} onResult={() => {}} onError={() => {}} />);
    fireEvent.blur(screen.getByText("タブを閉じる").closest(".context-menu")!, { relatedTarget: document.body });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("dismisses immediately and reports a successful command", async () => {
    const onDismiss = vi.fn();
    const onResult = vi.fn();
    vi.mocked(openContainingFolder).mockResolvedValue(undefined);
    render(<ContextMenu tab={tab} x={0} y={0} onDismiss={onDismiss} onClose={() => {}} onCloseOthers={() => {}} onCloseRight={() => {}} onNewWindow={() => {}} onResult={onResult} onError={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "フォルダを開く" }));
    expect(onDismiss).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith("フォルダーを開きました"));
  });

  it("dismisses and reports command failures", async () => {
    const onDismiss = vi.fn();
    const onError = vi.fn();
    vi.mocked(openContainingFolder).mockRejectedValue(new Error("起動失敗"));
    render(<ContextMenu tab={tab} x={0} y={0} onDismiss={onDismiss} onClose={() => {}} onCloseOthers={() => {}} onCloseRight={() => {}} onNewWindow={() => {}} onResult={() => {}} onError={onError} />);
    fireEvent.click(screen.getByRole("button", { name: "フォルダを開く" }));
    expect(onDismiss).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Error: 起動失敗"));
  });

  it("copies a regular Windows path without the extended-length prefix", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ContextMenu tab={{ ...tab, path: String.raw`\\?\C:\develop\MarkdownViewer\samples\sample.md` }} x={0} y={0} onDismiss={() => {}} onClose={() => {}} onCloseOthers={() => {}} onCloseRight={() => {}} onResult={() => {}} onError={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "フルパスをコピー" }));

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(String.raw`C:\develop\MarkdownViewer\samples\sample.md`));
  });

  it("disables filesystem actions for an untitled tab", () => {
    render(<ContextMenu tab={{ ...tab, untitled: true }} x={0} y={0} onDismiss={() => {}} onClose={() => {}} onCloseOthers={() => {}} onCloseRight={() => {}} onResult={() => {}} onError={() => {}} />);
    expect((screen.getByRole("button", { name: "フォルダを開く" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "VS Code で開く" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "別ウィンドウで開く" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
