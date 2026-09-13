import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexProposalReview } from "./CodexProposalReview";
import { validateDiagramReplacement } from "./diagram";

afterEach(cleanup);

function Fixture({ preview = false, validate }: { preview?: boolean; validate?: (value: string) => void }) {
  const [value, setValue] = useState("one\nchanged\nthree");
  return <CodexProposalReview original={"one\ntwo\nthree"} value={value} onChange={setValue} renderPreview={preview ? (source) => <pre>{source}</pre> : undefined} validate={validate} onAccept={vi.fn()} onReject={vi.fn()} onClose={vi.fn()} />;
}

describe("CodexProposalReview", () => {
  it("変更後を直接編集し、行単位で変更前へ戻せる", () => {
    render(<Fixture />);
    const editor = screen.getByLabelText("変更後を直接編集");
    fireEvent.change(editor, { target: { value: "one\nbroken\nthree" } });
    expect((screen.getByLabelText("変更後を直接編集") as HTMLTextAreaElement).value).toContain("broken");
    fireEvent.click(screen.getByRole("button", { name: /対応行2を変更前へ戻す/ }));
    expect((screen.getByLabelText("変更後を直接編集") as HTMLTextAreaElement).value).toBe("one\ntwo\nthree");
    fireEvent.click(screen.getByRole("button", { name: /対応行2へ生成案を再採用/ }));
    expect((screen.getByLabelText("変更後を直接編集") as HTMLTextAreaElement).value).toBe("one\nchanged\nthree");
  });
  it("図ではコードを初期折畳みし、前後プレビューと配置切替を表示する", () => {
    render(<Fixture preview />);
    expect((screen.getByLabelText("行単位の差分").parentElement as HTMLElement).hidden).toBe(true);
    expect(screen.getByText("変更前プレビュー")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "コード差分を表示" }));
    expect(screen.getByLabelText("行単位の差分")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "上下配置" }));
    expect(document.querySelector(".codex-proposal-review__previews--vertical")).toBeTruthy();
  });
  it("複数追加と削除を手編集しても、生成案の再採用が別行を壊さない", () => {
    function MultiFixture() { const [value, setValue] = useState("head\nadd-1\nadd-2\ntail"); return <CodexProposalReview original={"head\nremove-1\nremove-2\ntail"} value={value} onChange={setValue} onAccept={vi.fn()} onReject={vi.fn()} onClose={vi.fn()} />; }
    render(<MultiFixture />); fireEvent.change(screen.getByLabelText("変更後を直接編集"), { target: { value: "head\nmanual\ntail" } });
    fireEvent.click(screen.getByRole("button", { name: /対応行2へ生成案を再採用/ }));
    expect((screen.getByLabelText("変更後を直接編集") as HTMLTextAreaElement).value).toContain("tail");
    expect((screen.getByLabelText("変更後を直接編集") as HTMLTextAreaElement).value).not.toContain("remove-2");
  });
  it("実際のMermaid検証で不正案を拒否し、復旧後だけ採用できる", async () => {
    const accept = vi.fn();
    function DiagramFixture() { const [value, setValue] = useState("graph TD\nclick A https://bad.example"); return <CodexProposalReview original={"graph TD\nA-->B"} value={value} onChange={setValue} validate={(source) => { validateDiagramReplacement("mermaid", source); }} onAccept={accept} onReject={vi.fn()} onClose={vi.fn()} />; }
    render(<DiagramFixture />);
    fireEvent.click(screen.getByRole("button", { name: "採用" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Mermaid応答");
    expect(accept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "変更前へ復旧" }));
    fireEvent.click(screen.getByRole("button", { name: "採用" }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith("graph TD\nA-->B"));
  });
});
