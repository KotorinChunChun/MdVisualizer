export const DRAWIO_ORIGIN = "https://embed.diagrams.net";
export const DRAWIO_EDITOR_URL = `${DRAWIO_ORIGIN}/?embed=1&proto=json&spin=1&libraries=1&noSaveBtn=1`;

export type DrawioSourceKind = "empty" | "svg" | "mermaid" | "xml" | "compressed";
export type DrawioLoadPayload =
  | { kind: DrawioSourceKind; xml: string; warnings: string[] }
  | { kind: "mermaid"; descriptor: { format: "mermaid"; data: string; wrap: false }; warnings: string[] };

const MERMAID_DECLARATION = /^(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4(?:Context|Container|Component|Dynamic|Deployment)|architecture-beta|block-beta|packet-beta|xychart-beta|sankey-beta|kanban|radar-beta)\b/i;

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const number = (value: string | null, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const color = (value: string | null, fallback: string) => !value || value === "none" ? fallback : value;

export function classifyDrawioSource(source: string): DrawioSourceKind {
  const text = source.replace(/^\uFEFF/, "").trim();
  if (!text) return "empty";
  if (/^<svg(?:\s|>)/i.test(text)) return "svg";
  if (!text.startsWith("<") && MERMAID_DECLARATION.test(text.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/, "").trim())) return "mermaid";
  if (text.startsWith("<")) return "xml";
  return "compressed";
}

function paintStyle(element: Element, filled = true): string {
  const fill = filled ? color(element.getAttribute("fill"), "#ffffff") : "none";
  const stroke = color(element.getAttribute("stroke"), filled ? "none" : "#000000");
  const strokeWidth = Math.max(0, number(element.getAttribute("stroke-width"), 1));
  return `fillColor=${escapeXml(fill)};strokeColor=${escapeXml(stroke)};strokeWidth=${strokeWidth};`;
}

function geometry(x: number, y: number, width: number, height: number): string {
  return `<mxGeometry x="${x}" y="${y}" width="${Math.max(1, width)}" height="${Math.max(1, height)}" as="geometry"/>`;
}

function pointsOf(value: string): Array<{ x: number; y: number }> {
  const numbers = value.trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) points.push({ x: numbers[index], y: numbers[index + 1] });
  return points;
}

/** Converts common SVG primitives into independently editable draw.io cells. */
export function svgToDrawioXml(source: string): { xml: string; warnings: string[] } {
  const documentNode = new DOMParser().parseFromString(source, "image/svg+xml");
  if (documentNode.querySelector("parsererror") || documentNode.documentElement.tagName.toLowerCase() !== "svg") throw new Error("SVGを解析できませんでした。");
  const cells: string[] = [];
  const unsupported = new Set<string>();
  let sequence = 2;
  const nextId = () => String(sequence++);
  for (const element of [...documentNode.documentElement.querySelectorAll("rect,circle,ellipse,line,polyline,polygon,text,path,image,g,use")]) {
    const tag = element.tagName.toLowerCase();
    if (element.closest("defs")) continue;
    if (tag === "g") continue;
    const id = nextId();
    if (tag === "rect") {
      const x = number(element.getAttribute("x")); const y = number(element.getAttribute("y"));
      const width = number(element.getAttribute("width")); const height = number(element.getAttribute("height"));
      const rounded = number(element.getAttribute("rx")) > 0 || number(element.getAttribute("ry")) > 0 ? "rounded=1;" : "";
      cells.push(`<mxCell id="${id}" value="" style="${rounded}${paintStyle(element)}whiteSpace=wrap;html=1;" vertex="1" parent="1">${geometry(x, y, width, height)}</mxCell>`);
    } else if (tag === "circle" || tag === "ellipse") {
      const rx = tag === "circle" ? number(element.getAttribute("r")) : number(element.getAttribute("rx"));
      const ry = tag === "circle" ? rx : number(element.getAttribute("ry"));
      const cx = number(element.getAttribute("cx")); const cy = number(element.getAttribute("cy"));
      cells.push(`<mxCell id="${id}" value="" style="ellipse;${paintStyle(element)}whiteSpace=wrap;html=1;" vertex="1" parent="1">${geometry(cx - rx, cy - ry, rx * 2, ry * 2)}</mxCell>`);
    } else if (tag === "line") {
      const x1 = number(element.getAttribute("x1")); const y1 = number(element.getAttribute("y1"));
      const x2 = number(element.getAttribute("x2")); const y2 = number(element.getAttribute("y2"));
      cells.push(`<mxCell id="${id}" value="" style="endArrow=none;html=1;${paintStyle(element, false)}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${x1}" y="${y1}" as="sourcePoint"/><mxPoint x="${x2}" y="${y2}" as="targetPoint"/></mxGeometry></mxCell>`);
    } else if (tag === "polygon" || tag === "polyline") {
      const points = pointsOf(element.getAttribute("points") ?? "");
      if (points.length < 2) { unsupported.add(tag); continue; }
      const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
      const x = Math.min(...xs); const y = Math.min(...ys); const width = Math.max(1, Math.max(...xs) - x); const height = Math.max(1, Math.max(...ys) - y);
      const normalized = points.map((point) => [Number(((point.x - x) / width).toFixed(5)), Number(((point.y - y) / height).toFixed(5))]);
      const style = `shape=mxgraph.basic.polygon;polyCoords=${JSON.stringify(normalized)};polyline=${tag === "polyline" ? 1 : 0};whiteSpace=wrap;html=1;${paintStyle(element, tag === "polygon")}`;
      cells.push(`<mxCell id="${id}" value="" style="${escapeXml(style)}" vertex="1" parent="1">${geometry(x, y, width, height)}</mxCell>`);
    } else if (tag === "text") {
      const x = number(element.getAttribute("x")); const y = number(element.getAttribute("y"));
      const size = Math.max(8, number(element.getAttribute("font-size"), 16));
      const value = escapeXml(element.textContent?.trim() ?? "");
      cells.push(`<mxCell id="${id}" value="${value}" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontSize=${size};fontColor=${escapeXml(color(element.getAttribute("fill"), "#000000"))};" vertex="1" parent="1">${geometry(x, y - size, Math.max(40, value.length * size), size * 1.5)}</mxCell>`);
    } else unsupported.add(tag);
  }
  if (!cells.length) throw new Error("変換可能なSVG要素が見つかりませんでした。");
  const warnings = [...unsupported].map((tag) => `SVGの <${tag}> 要素は個別図形へ変換できないためスキップしました。`);
  return {
    xml: `<mxGraphModel dx="1000" dy="700" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join("")}</root></mxGraphModel>`,
    warnings,
  };
}

export function prepareDrawioLoad(source: string): DrawioLoadPayload {
  const text = source.replace(/^\uFEFF/, "").trim();
  const kind = classifyDrawioSource(text);
  if (kind === "mermaid") return { kind, descriptor: { format: "mermaid", data: text, wrap: false }, warnings: [] };
  if (kind === "svg") {
    const converted = svgToDrawioXml(text);
    return { kind, xml: converted.xml, warnings: converted.warnings };
  }
  if (kind === "empty") return { kind, xml: "<mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/></root></mxGraphModel>", warnings: [] };
  if (kind === "compressed") return { kind, xml: `<mxfile host="embed.diagrams.net"><diagram name="Page-1">${escapeXml(text)}</diagram></mxfile>`, warnings: [] };
  const documentNode = new DOMParser().parseFromString(text, "application/xml");
  const root = documentNode.documentElement.tagName;
  if (documentNode.querySelector("parsererror") || (root !== "mxGraphModel" && root !== "mxfile")) throw new Error("draw.io XMLはmxGraphModelまたはmxfile形式で指定してください。");
  return { kind, xml: text, warnings: [] };
}

/** Page View is an mxGraphModel setting, even when the model is wrapped by mxfile. */
export function disableDrawioPageView(xml: string): string {
  return xml.replace(/<mxGraphModel\b([^>]*)>/g, (model, attributes: string) => {
    if (/\bpage\s*=/.test(attributes)) {
      return model.replace(/\bpage\s*=\s*(?:"[^"]*"|'[^']*')/, 'page="0"');
    }
    return `<mxGraphModel${attributes} page="0">`;
  });
}

export function extractDrawioFenceData(xml: string): string {
  const text = xml.trim();
  if (!text.startsWith("<")) return text;
  const documentNode = new DOMParser().parseFromString(text, "application/xml");
  if (documentNode.querySelector("parsererror")) throw new Error("draw.ioの保存XMLを解析できませんでした。");
  if (documentNode.documentElement.tagName === "mxGraphModel") return text;
  if (documentNode.documentElement.tagName !== "mxfile") throw new Error("draw.ioから未対応のXML形式を受信しました。");
  const diagram = documentNode.querySelector("diagram");
  if (!diagram) return text;
  const element = [...diagram.childNodes].find((node) => node.nodeType === Node.ELEMENT_NODE);
  return element ? new XMLSerializer().serializeToString(element) : (diagram.textContent ?? "").trim();
}

export interface DrawioMessage { event?: string; xml?: string; exit?: boolean; modified?: boolean; pageVisible?: boolean }

export function parseTrustedDrawioMessage(event: Pick<MessageEvent, "origin" | "source" | "data">, expectedSource: MessageEventSource | null): DrawioMessage | null {
  if (event.origin !== DRAWIO_ORIGIN || !expectedSource || event.source !== expectedSource) return null;
  try {
    const value = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    return value && typeof value === "object" ? value as DrawioMessage : null;
  } catch {
    return null;
  }
}
