import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeBlock, powerShellWorkingDirectory, syntaxHighlightLanguageName } from "./CodeBlock";
import { copyTextFile, runPowerShell } from "../lib/commands";

vi.mock("../lib/commands", () => ({ copyTextFile: vi.fn(), runPowerShell: vi.fn() }));

describe("CodeBlock", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

  it("shows the normalized syntax highlighting language and embedded file title", () => {
    render(<CodeBlock className="language-ts" headingTitle="src/index.ts">const value = 1;</CodeBlock>);

    expect(screen.getByText("TypeScript").className).toContain("code-block__language");
    expect(screen.getByText("src/index.ts").className).toContain("code-block__heading");
    expect(syntaxHighlightLanguageName("ps1")).toBe("PowerShell");
    expect(syntaxHighlightLanguageName("unknown-language")).toBe("unknown-language");
  });

  it("copies only code text and emits a success notification", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const listener = vi.fn();
    window.addEventListener("markdown-toast", listener);
    render(<CodeBlock className="language-typescript">{"const answer = 42;\n"}</CodeBlock>);
    const button = screen.getByRole("button", { name: "Copy" });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const answer = 42;"));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ type: "success", message: "コードをコピーしました" }) }));
    expect(document.activeElement).not.toBe(button);
    window.removeEventListener("markdown-toast", listener);
  });

  it("emits an error notification when the clipboard rejects the copy", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const listener = vi.fn();
    window.addEventListener("markdown-toast", listener);
    render(<CodeBlock className="language-json">{"{\"ok\":true}"}</CodeBlock>);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: { type: "error", message: "コードをコピーできませんでした" } })));
    window.removeEventListener("markdown-toast", listener);
  });

  it("notifies its parent after asynchronous syntax highlighting commits", async () => {
    const onHighlightComplete = vi.fn();
    render(<CodeBlock className="language-typescript" onHighlightComplete={onHighlightComplete}>{"const cargo = 1;"}</CodeBlock>);
    await waitFor(() => expect(onHighlightComplete).toHaveBeenCalled());
    expect(document.querySelector("code .hljs-keyword")?.textContent).toBe("const");
  });

  it("requires explicit confirmation before running an allowed PowerShell block", async () => {
    const documentPath = String.raw`C:\docs\sample.md`;
    vi.mocked(runPowerShell).mockResolvedValue({ stdout: "safe-output\n", stderr: "", exitCode: 0, timedOut: false, truncated: false, durationMs: 25 });
    render(<CodeBlock className="language-pwsh" documentPath={documentPath}>{"Write-Output 'safe-output'"}</CodeBlock>);

    fireEvent.click(screen.getByRole("button", { name: "PowerShellを実行" }));
    const workingDirectory = screen.getByRole("textbox", { name: "作業フォルダー" }) as HTMLInputElement;
    expect(workingDirectory.value).toBe(String.raw`C:\docs`);
    expect(workingDirectory.readOnly).toBe(true);
    expect(runPowerShell).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "実行する" }));

    await waitFor(() => expect(runPowerShell).toHaveBeenCalledWith({ documentPath, language: "pwsh", source: "Write-Output 'safe-output'" }));
    expect((await screen.findByLabelText("標準出力")).textContent).toContain("safe-output");
    expect(screen.getByLabelText("PowerShell実行結果").textContent).toContain("終了コード: 0");
  });

  it("does not offer execution for unlabeled or non-PowerShell code", () => {
    const { rerender } = render(<CodeBlock className="language-bash" documentPath={String.raw`C:\docs\sample.md`}>echo no</CodeBlock>);
    expect(screen.queryByRole("button", { name: "PowerShellを実行" })).toBeNull();
    rerender(<CodeBlock className="language-powershell">Write-Output no-path</CodeBlock>);
    expect(screen.queryByRole("button", { name: "PowerShellを実行" })).toBeNull();
  });

  it("offers TXT and source-file copies from the copy notification", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.mocked(copyTextFile).mockResolvedValue("C:\\temp\\code.ts");
    let detail: { actions?: Array<{ label: string; onAction: () => Promise<void> }> } | undefined;
    const listener = (event: Event) => { detail = (event as CustomEvent).detail; };
    window.addEventListener("markdown-toast", listener);
    render(<CodeBlock className="language-typescript">{"const value = 1;"}</CodeBlock>);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(detail?.actions?.map((action) => action.label)).toEqual(["TXTファイルでコピー", "ソースファイルとしてコピー"]));
    const actions = detail?.actions;
    await actions?.[0].onAction();
    await actions?.[1].onAction();

    expect(copyTextFile).toHaveBeenNthCalledWith(1, { filename: "code.txt", content: "const value = 1;" });
    expect(copyTextFile).toHaveBeenNthCalledWith(2, { filename: "code.ts", content: "const value = 1;" });
    window.removeEventListener("markdown-toast", listener);
  });

  it.each([
    ["embedded", "外部ファイルへ切替"],
    ["external", "埋め込みへ切替"],
  ] as const)("%s保存形式の切替ボタンを表示して処理を呼ぶ", async (storage, label) => {
    const onStorageConvert = vi.fn().mockResolvedValue(undefined);
    render(<CodeBlock className="language-typescript" storage={storage} onStorageConvert={onStorageConvert}>const value = 1;</CodeBlock>);

    fireEvent.click(screen.getByRole("button", { name: label }));

    await waitFor(() => expect(onStorageConvert).toHaveBeenCalledTimes(1));
  });

  it("normalizes Windows verbatim paths before showing the Markdown directory", () => {
    expect(powerShellWorkingDirectory(String.raw`\\?\C:\docs\sample.md`)).toBe(String.raw`C:\docs`);
    expect(powerShellWorkingDirectory(String.raw`\\?\UNC\server\share\sample.md`)).toBe(String.raw`\\server\share`);
    expect(powerShellWorkingDirectory(String.raw`C:\sample.md`)).toBe("C:\\");
  });

  it("renders a key language block with the shared shortcut SVG", () => {
    const { container } = render(<CodeBlock className="language-key">{"Ctrl+Shift+S"}</CodeBlock>);
    expect(container.querySelector(".shortcut-key-block")).not.toBeNull();
    expect(container.querySelector("svg.shortcut-key-svg--block")).not.toBeNull();
    expect(screen.getByRole("img", { name: "キーボードショートカット: Ctrl + Shift + S" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Copy" })).not.toBeNull();
  });
});
