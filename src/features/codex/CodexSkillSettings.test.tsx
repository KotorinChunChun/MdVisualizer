import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodexSkillSettings } from "./CodexSkillSettings";
import { reloadSkills } from "./skills";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
afterEach(cleanup);

const files = (source = "---\nname: demo\ndescription: Demo\nmetadata:\n  mdvisualizer:\n    enabled: true\n    targets: [text]\n    contextMenu: true\n    blockMenu: false\n---\n\n回答") => ({ directory: "C:/skills", files: [{ id: "demo", source }] });

describe("CodexSkillSettings", () => {
  beforeEach(() => { invoke.mockReset(); invoke.mockResolvedValue(files()); });

  it("saves edited prompt and reloads the skill list", async () => {
    await reloadSkills();
    render(<CodexSkillSettings />);
    fireEvent.click(await screen.findByRole("button", { name: /Demo/ }));
    fireEvent.change(screen.getByLabelText("スキルファイル（属性とプロンプト）"), { target: { value: files().files[0].source.replace("回答", "新しい回答") } });
    fireEvent.click(screen.getByRole("button", { name: "スキルを保存" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("codex_save_skill", expect.objectContaining({ id: "demo", source: expect.stringContaining("新しい回答") })));
    expect(invoke).toHaveBeenCalledWith("codex_list_skills");
  });

  it("keeps an unsaved draft when switching skills and exposes per-target menu checks", async () => {
    const second = "---\nname: other\ndescription: Other\n---\n\nOther";
    invoke.mockResolvedValue({ directory: "C:/skills", files: [...files().files, { id: "other", source: second }] });
    await reloadSkills();
    render(<CodexSkillSettings />);
    fireEvent.click(await screen.findByRole("button", { name: /Demo/ }));
    const textarea = screen.getByLabelText("スキルファイル（属性とプロンプト）");
    fireEvent.change(textarea, { target: { value: (textarea as HTMLTextAreaElement).value.replace("回答", "下書き") } });
    fireEvent.click(screen.getByRole("button", { name: /Other/ }));
    fireEvent.click(screen.getByRole("button", { name: /Demo/ }));
    expect((screen.getByLabelText("スキルファイル（属性とプロンプト）") as HTMLTextAreaElement).value).toContain("下書き");
    expect(screen.getByLabelText("通常テキストの右クリックメニューに表示")).toBeTruthy();
  });
});
