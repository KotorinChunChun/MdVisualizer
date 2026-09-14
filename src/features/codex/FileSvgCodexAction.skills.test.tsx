import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileSvgCodexAction } from "./FileSvgCodexAction";

const { loadMarkdown, saveMarkdown, visibleSkills } = vi.hoisted(() => ({ loadMarkdown: vi.fn(), saveMarkdown: vi.fn(), visibleSkills: vi.fn() }));
vi.mock("../../lib/commands", () => ({ loadMarkdown, saveMarkdown }));
vi.mock("./skills", () => ({ useCodexSkills: () => [], visibleSkills }));
vi.mock("./DiagramCodexAction", () => ({ DiagramCodexDialog: (props: { initialSkillId?: string; initialConversationAction?: string; onSave: (source: string) => Promise<boolean> }) => <div role="dialog"><span>{props.initialSkillId}:{props.initialConversationAction}</span><button type="button" onClick={() => void props.onSave("<svg/>")}>採用テスト</button></div> }));

afterEach(cleanup);
describe("FileSvgCodexAction skill placement", () => {
  beforeEach(() => {
    loadMarkdown.mockResolvedValue({ path: "C:/docs/a.svg", kind: "svg", content: "<svg/>", base_dir: "C:/docs", image_paths: [], encoding: "UTF-8", size_bytes: 6, modified_at: "", revision: "r1" });
    saveMarkdown.mockResolvedValue({ status: "ok", document: { path: "C:/docs/a.svg", kind: "svg", content: "<svg/>", revision: "r2" } });
    visibleSkills.mockImplementation((_skills: unknown, _kind: string, place: string) => place === "blockMenu" ? [{ id: "block-skill", config: { label: "ブロック編集", enabled: true, targets: ["svg"], blockMenu: true, contextMenu: false, mode: "selection" } }] : [{ id: "context-skill", config: { label: "右クリック相談", enabled: true, targets: ["svg"], blockMenu: false, contextMenu: true, mode: "question" } }]);
  });
  it("uses blockMenu for the button and contextMenu for right click, then forwards add/new and revision", async () => {
    render(<FileSvgCodexAction path="C:/docs/a.svg" />);
    fireEvent.click(screen.getByRole("button", { name: "AI▽" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "ブロック編集" }));

    await screen.findByRole("dialog");
    expect(screen.getByRole("dialog")).toHaveTextContent("block-skill:new");
    fireEvent.click(screen.getByRole("button", { name: "採用テスト" }));
    await waitFor(() => expect(saveMarkdown).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: "r1", content: "<svg/>" })));

    cleanup();
    const wrapper = render(<FileSvgCodexAction path="C:/docs/a.svg"><span>図</span></FileSvgCodexAction>);
    fireEvent.contextMenu(wrapper.container.querySelector("div")!, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: "右クリック相談" }));

    await screen.findByRole("dialog");
    expect(screen.getByRole("dialog")).toHaveTextContent("context-skill:new");
  });
});
