import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CodexProposalReview } from "./CodexProposalReview";
import { DiagramProposalPreview } from "./DiagramProposalPreview";
import { validateDiagramForAdoption, type CodexDiagramKind } from "./diagram";

// ブラウザー専用の描画面だけ置換。XML sanitizerとMermaid parserは実装を使う。
vi.mock("../../components/MermaidBlock", () => ({ MermaidBlock: ({ source }: { source: string }) => <pre data-testid="mermaid-drawing">{source}</pre> }));
vi.mock("../../components/DrawioBlock", () => ({ DrawioBlock: ({ source }: { source: string }) => <pre data-testid="drawio-drawing">{source}</pre> }));
afterEach(cleanup);
beforeAll(async () => { const { default: mermaid } = await import("mermaid"); await mermaid.parse("flowchart TD\nA-->B"); }, 30000);
const valid = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="12"/></svg>',
  drawio: '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>',
  mermaid: 'flowchart TD\nA[開始] --> B[終了]',
};
function Fixture({ kind }: { kind: CodexDiagramKind }) {
  const [value, setValue] = useState(valid[kind]);
  return <CodexProposalReview original={valid[kind]} value={value} onChange={setValue} onAccept={vi.fn()} onReject={vi.fn()} onClose={vi.fn()}
    renderPreview={source => <DiagramProposalPreview kind={kind} source={source} theme="light" />} validate={async source => { await validateDiagramForAdoption(kind, source); }} />;
}
describe("コード編集に追従する図の比較", () => {
  it.each(["svg", "drawio", "mermaid"] as const)("%sを故意に壊すとエラーを出し、修復すると変更後を更新する", async kind => {
    render(<Fixture kind={kind} />);
    fireEvent.click(screen.getByRole("button", { name: "コード差分を表示" }));
    const editor = screen.getByLabelText("変更後を直接編集");
    fireEvent.change(editor, { target: { value: kind === "mermaid" ? "flowchart TD\nA[閉じていない" : "<broken><" } });
    expect(await screen.findByRole("alert")).toBeTruthy();
    const repaired = kind === "svg" ? valid.svg.replace('r="12"', 'r="24"') : kind === "mermaid" ? valid.mermaid.replace("終了", "修復済み") : valid.drawio.replace("<mxGraphModel>", '<mxGraphModel dx="123">');
    fireEvent.change(editor, { target: { value: repaired } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    if (kind === "svg") expect(screen.getAllByLabelText("SVG変更案")[1].querySelector("circle")?.getAttribute("r")).toBe("24");
    else expect(screen.getAllByTestId(`${kind}-drawing`)[1].textContent).toBe(repaired);
  });
});
