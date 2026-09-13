import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiagramCodexAction } from "./DiagramCodexAction";
import { FileSvgCodexAction } from "./FileSvgCodexAction";
import { cancelCodex, generateCodex } from "./api";
import { loadMarkdown, saveMarkdown } from "../../lib/commands";
import type { CodexReply } from "./model";
import type { MarkdownLoadResult } from "../../types/app";
vi.mock("./api", () => ({ generateCodex: vi.fn(), cancelCodex: vi.fn().mockResolvedValue(undefined), listCodexLogs: vi.fn().mockResolvedValue({ entries: [], limit: 20 }), setCodexLogLimit: vi.fn() }));
vi.mock("../../lib/commands", () => ({ loadSettings: vi.fn().mockResolvedValue({ codex: { enabled: true, model: "gpt-5.6-luna" } }), saveSettings: vi.fn(), loadMarkdown: vi.fn(), saveMarkdown: vi.fn() }));
vi.mock("../../components/DrawioBlock", () => ({ DrawioBlock: ({ source }: { source: string }) => <pre data-testid="drawio-preview">{source}</pre> }));
vi.mock("./sessions", async original => ({ ...await original<typeof import("./sessions")>(), loadCodexSessions: vi.fn(async () => ({ sessions: [], retentionDays: 30 })), upsertCodexSession: vi.fn(async () => ({ sessions: [], retentionDays: 30 })) }));
vi.mock("./preview", async original => ({ ...await original<typeof import("./preview")>(), diagramImage: vi.fn(async () => ({ base64: "cG5n", mime: "image/png" })) }));
const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
const replacement = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="20"/></svg>';
beforeEach(() => { vi.clearAllMocks(); vi.mocked(generateCodex).mockResolvedValue({ answer: "変更しました", replacement }); });
afterEach(cleanup);
async function send() {
  await waitFor(() => expect(screen.getByLabelText("指示")).not.toBeDisabled());
  fireEvent.change(await screen.findByLabelText("指示"), { target: { value: "配置・余白を整えてください" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "送信（Ctrl+Enter）" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "送信（Ctrl+Enter）" }));
}
async function openDiagram(action = "AIで見た目を改善") {
  fireEvent.click(screen.getByRole("button", { name: "AIに図の編集を依頼" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: action }));
  fireEvent.click(screen.getByRole("menuitem", { name: "新しい会話を開始" }));
}
describe("図メニューのCodex連携", () => {
  it("対象SVGだけを送り、サニタイズ済みのプレビューを採用してから反映する", async () => {
    const save = vi.fn().mockResolvedValue(true);
    render(<DiagramCodexAction kind="svg" source={source} onSave={save} />);
    await openDiagram(); await send();
    await screen.findByText("採用");
    expect(generateCodex).toHaveBeenCalledWith(expect.objectContaining({ text: source, instruction: expect.stringContaining("配置・余白") }));
    expect(screen.getAllByLabelText("SVG変更案")[1].querySelector("circle")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("採用"));
    await waitFor(() => expect(save).toHaveBeenCalledWith(replacement));
  });
  it("自由入力でdraw.io図のXMLを生成する", async () => {
    const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
    vi.mocked(generateCodex).mockResolvedValue({ answer: "作成しました", replacement: xml });
    const save = vi.fn().mockResolvedValue(true);
    render(<DiagramCodexAction kind="drawio" source="" onSave={save} />);
    await openDiagram("AIに図の編集を依頼");
    await screen.findByLabelText("指示");
    await waitFor(() => expect(screen.getByLabelText("指示")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("指示"), { target: { value: "APIの構成図を描いて" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "送信（Ctrl+Enter）" })).not.toBeDisabled());
    fireEvent.keyDown(screen.getByLabelText("指示"), { key: "Enter", ctrlKey: true });
    await screen.findByText("採用");
    expect(generateCodex).toHaveBeenCalledWith(expect.objectContaining({ instruction: expect.stringContaining("APIの構成図を描いて") }));
    expect(screen.getAllByTestId("drawio-preview")[1]).toHaveTextContent("mxGraphModel");
    fireEvent.click(screen.getByText("採用"));
    await waitFor(() => expect(save).toHaveBeenCalledWith(xml));
  });
  it("生成後に元ソースが変わった場合は反映しない", async () => {
    const save = vi.fn();
    const view = render(<DiagramCodexAction kind="svg" source={source} onSave={save} />);
    await openDiagram(); await send(); await screen.findByText("採用");
    view.rerender(<DiagramCodexAction kind="svg" source={replacement} onSave={save} />);
    fireEvent.click(screen.getByText("採用"));
    expect(save).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("変わりました");
  });
  it("保存競合でも変更案を保持する", async () => {
    const save = vi.fn().mockRejectedValue(new Error("外部更新との競合"));
    render(<DiagramCodexAction kind="svg" source={source} onSave={save} />);
    await openDiagram(); await send(); await screen.findByText("採用");
    fireEvent.click(screen.getByText("採用"));
    expect(await screen.findByRole("alert")).toHaveTextContent("外部更新との競合");
    expect(screen.getAllByLabelText("SVG変更案")[1]).toBeVisible();
  });
  it("閉じた後に届いた応答を反映しない", async () => {
    let resolve!: (value: CodexReply) => void;
    vi.mocked(generateCodex).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const save = vi.fn();
    render(<DiagramCodexAction kind="svg" source={source} onSave={save} />);
    await openDiagram(); await send();
    await waitFor(() => expect(generateCodex).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText("AIパネルを閉じる"));
    await act(async () => { resolve({ answer: "遅い応答", replacement }); });
    expect(cancelCodex).toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
  it("外部SVGはクリック時に読込revisionを取得し、採用時にだけ保存する", async () => {
    const document: MarkdownLoadResult = { path: "C:/docs/a.svg", kind: "svg", content: source, base_dir: "C:/docs", image_paths: [], encoding: "UTF-8", size_bytes: source.length, modified_at: "", revision: "r1" };
    vi.mocked(loadMarkdown).mockResolvedValue(document);
    vi.mocked(saveMarkdown).mockResolvedValue({ status: "conflict", latest: { ...document, revision: "r2" } });
    render(<FileSvgCodexAction path={document.path} />);
    expect(loadMarkdown).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("AIに図の編集を依頼"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "AIで見た目を改善" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "現在の会話に追加" }));
    await send(); await screen.findByText("採用");
    expect(saveMarkdown).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("採用"));
    await screen.findByRole("alert");
    expect(saveMarkdown).toHaveBeenCalledWith({ path: document.path, content: replacement, expectedRevision: "r1", stagedAssetIds: [] });
    expect(screen.getAllByLabelText("SVG変更案")[1]).toBeVisible();
  });
});
