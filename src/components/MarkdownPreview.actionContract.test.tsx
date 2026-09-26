import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
import { previewOperationPolicy } from "../lib/previewOperationPolicy";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const bindings = {
  onCodeFenceBodyChange: vi.fn(), onInlineSvgChange: vi.fn(), onMarkdownTableChange: vi.fn(),
  onDrawioStorageConvert: vi.fn(), onMermaidStorageConvert: vi.fn(), onTableStorageConvert: vi.fn(),
  onTextStorageConvert: vi.fn(), onAssetStorageConvert: vi.fn(), onExternalTableChange: vi.fn(),
};
const formats = [
  ["TSV", "```tsv\n名前\t値\n項目\t1\n```", /表を編集/, true],
  ["Markdown", "```markdown\n# 内容\n```", /^編集$/, true],
  ["SVG", '```svg\n<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="10" height="10"/></svg>\n```', /^編集$/, true],
  ["draw.io", "```drawio\n<mxfile><diagram><mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/></root></mxGraphModel></diagram></mxfile>\n```", /^編集$/, true],
  ["GFM表", "|名前|値|\n|---|---|\n|項目|1|", /表を編集/, false],
] as const;

for (const [name, content, edit, converts] of formats) {
  for (const interactionMode of ["browse", "edit"] as const) {
    for (const width of [1600, 260, 60]) {
      it(`${name}: ${interactionMode}・幅${width}でも編集と変換の入口を保持`, () => {
        vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
        vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(100);
        vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { callback(0); return 1; });
        vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
        const policy = previewOperationPolicy({ writable: true, interactionMode });
        render(<MarkdownPreview {...bindings} content={content} baseDir="" documentPath="sample.md" imageVersions={{}}
          actionContractHost="desktop" readOnly={!policy.directEditing} allowBlockActions={policy.editBlocks} />);
        for (const button of screen.queryAllByRole("button", { name: "その他の操作" })) fireEvent.click(button);
        expect(screen.getByRole("button", { name: edit })).toBeTruthy();
        if (converts) expect(screen.getByRole("button", { name: /外部ファイル/ })).toBeTruthy();
      });
    }
  }
  it(`${name}: 更新不可では編集・変換を提供しない`, () => {
    const policy = previewOperationPolicy({ writable: false, interactionMode: "edit" });
    render(<MarkdownPreview {...bindings} content={content} baseDir="" documentPath="sample.md" imageVersions={{}}
      actionContractHost="desktop" readOnly={!policy.directEditing} allowBlockActions={policy.editBlocks} />);
    expect(screen.queryByRole("button", { name: edit })).toBeNull();
    expect(screen.queryByRole("button", { name: /外部ファイル/ })).toBeNull();
  });
}
