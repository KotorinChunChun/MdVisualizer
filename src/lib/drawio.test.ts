import { describe, expect, it } from "vitest";
import { DRAWIO_ORIGIN, classifyDrawioSource, extractDrawioFenceData, parseTrustedDrawioMessage, prepareDrawioLoad, svgToDrawioXml } from "./drawio";

describe("draw.io source handling", () => {
  it("recognises every supported source representation", () => {
    expect(classifyDrawioSource("")).toBe("empty");
    expect(classifyDrawioSource("<mxGraphModel/>" )).toBe("xml");
    expect(classifyDrawioSource("<svg xmlns=\"http://www.w3.org/2000/svg\"/>" )).toBe("svg");
    expect(classifyDrawioSource("flowchart LR\nA-->B")).toBe("mermaid");
    expect(classifyDrawioSource("tZVRT9swEMc/TR5B")).toBe("compressed");
  });

  it("uses the official Mermaid descriptor and wraps compressed diagrams", () => {
    expect(prepareDrawioLoad("flowchart LR\nA-->B")).toMatchObject({ descriptor: { format: "mermaid", wrap: false } });
    expect(prepareDrawioLoad("abc+/=")).toMatchObject({ kind: "compressed", xml: expect.stringContaining("<mxfile") });
    expect(() => prepareDrawioLoad("<html/>" )).toThrow(/mxGraphModel/);
  });

  it("converts SVG rectangles and polygons into separate editable cells", () => {
    const result = svgToDrawioXml('<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="100" height="80" fill="#0863F5"/><polygon points="50,5 90,75 10,75" fill="#fff"/><path d="M0 0L1 1"/></svg>');
    expect(result.xml.match(/<mxCell/g)).toHaveLength(4);
    expect(result.xml).toContain("shape=mxgraph.basic.polygon");
    expect(result.warnings).toEqual(["SVGの <path> 要素は個別図形へ変換できないためスキップしました。"]);
  });

  it("extracts nested and compressed page data from mxfile saves", () => {
    expect(extractDrawioFenceData('<mxfile><diagram><mxGraphModel><root/></mxGraphModel></diagram></mxfile>')).toContain("mxGraphModel");
    expect(extractDrawioFenceData('<mxfile><diagram>compressed-data</diagram></mxfile>')).toBe("compressed-data");
  });
});

describe("draw.io message trust", () => {
  it("accepts only the expected source and official origin", () => {
    const source = {} as MessageEventSource;
    expect(parseTrustedDrawioMessage({ origin: DRAWIO_ORIGIN, source, data: '{"event":"init"}' }, source)).toEqual({ event: "init" });
    expect(parseTrustedDrawioMessage({ origin: "https://evil.example", source, data: { event: "save", xml: "bad" } }, source)).toBeNull();
    expect(parseTrustedDrawioMessage({ origin: DRAWIO_ORIGIN, source: {} as MessageEventSource, data: { event: "save" } }, source)).toBeNull();
    expect(parseTrustedDrawioMessage({ origin: DRAWIO_ORIGIN, source, data: "not-json" }, source)).toBeNull();
  });
});
