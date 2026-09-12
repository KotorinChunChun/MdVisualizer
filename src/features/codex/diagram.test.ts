import { describe, expect, it } from "vitest";
import { diagramInstruction, validateDiagramReplacement } from "./diagram";

const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" vertex="1" value="開始"><mxGeometry x="10" y="20" width="100" height="50" as="geometry"/></mxCell></root></mxGraphModel>';
describe("Codex図の応答検証", () => {
  it("SVGの実行可能な内容と外部参照を表示・保存前に除去する", () => {
    const safe = validateDiagramReplacement("svg", '<svg xmlns="http://www.w3.org/2000/svg" onload="bad()"><script>bad()</script><image href="https://example.com/a"/><rect fill="red" width="10" height="20"/></svg>');
    expect(safe).not.toMatch(/onload|script|https:/);
    expect(safe).toContain('fill="red"');
  });
  it("非圧縮draw.ioの単ページと複数ページを維持する", () => {
    expect(validateDiagramReplacement("drawio", model)).toBe(model);
    const multi = `<mxfile><diagram name="一">${model}</diagram><diagram name="二">${model}</diagram></mxfile>`;
    expect(validateDiagramReplacement("drawio", multi)).toBe(multi);
  });
  it.each(["", "```svg\n<svg/>\n```", '<!DOCTYPE svg [<!ENTITY x "a">]><svg/>', "<html/>"])("不正SVGを採用しない: %s", (source) => expect(() => validateDiagramReplacement("svg", source)).toThrow());
  it.each([
    "<mxfile><diagram>compressed</diagram></mxfile>",
    "<mxGraphModel><root/></mxGraphModel>",
    model.replace('id="2"', 'id="1"'),
    model.replace('parent="1"', 'parent="missing"'),
    model.replace('value="開始"', 'value="&lt;img src=&quot;https://example.com&quot;/&gt;"'),
    model.replace('value="開始"', 'style="image=https://example.com/a;"'),
    model.replace('value="開始"', 'onclick="bad()"'),
    model.replace("</root>", "<script>bad()</script></root>"),
  ])("不正または外部参照のdraw.ioを採用しない", (source) => expect(() => validateDiagramReplacement("drawio", source)).toThrow());
  it("自由入力と出力形式の指示を両方含める", () => {
    expect(diagramInstruction("svg", "猫の図を描いて")).toContain("猫の図を描いて");
    expect(diagramInstruction("drawio", "整形して")).toContain("mxGraphModel");
  });
});
