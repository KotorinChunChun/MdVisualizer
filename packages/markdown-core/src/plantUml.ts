export type PlantUmlDiagramKind = "sequence" | "class" | "activity";

export interface PlantUmlConversion {
  kind: PlantUmlDiagramKind;
  mermaid: string;
}

const LOCAL_UNSAFE_DIRECTIVE = /^\s*!(?:include|includeurl|include_many|import|pragma)\b/i;
const WRAPPER = /^\s*@(?:start|end)uml(?:\s+\S+)?\s*$/i;

export function isPlantUmlFenceLanguage(language: string | null | undefined): boolean {
  return language?.toLowerCase() === "plantuml" || language?.toLowerCase() === "puml";
}

function sourceLines(source: string): string[] {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => !WRAPPER.test(line));
  const unsafe = lines.find((line) => LOCAL_UNSAFE_DIRECTIVE.test(line));
  if (unsafe) throw new Error(`ローカル描画では外部参照命令を使用できません: ${unsafe.trim()}`);
  return lines.filter((line) => !/^\s*(?:'|\/\/)/.test(line) && !/^\s*skinparam\b/i.test(line));
}

function sequenceParticipant(line: string): string {
  return line.replace(/^\s*(boundary|control|entity|database|collections|queue)\b/i, "participant");
}

function sequenceArrow(line: string): string | null {
  const match = line.match(/^\s*("[^"]+"|[\w.]+)\s*(--?>|<--?)\s*("[^"]+"|[\w.]+)\s*(?::\s*(.*))?$/);
  if (!match) return null;
  const [, left, arrow, right, label = ""] = match;
  const dotted = arrow.includes("--");
  if (arrow.startsWith("<")) return `${right}${dotted ? "-->>" : "->>"}${left}${label ? `: ${label}` : ""}`;
  return `${left}${dotted ? "-->>" : "->>"}${right}${label ? `: ${label}` : ""}`;
}

function convertSequence(lines: string[]): PlantUmlConversion {
  const body = lines.flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || /^title\b/i.test(trimmed)) return [];
    if (/^(participant|actor|boundary|control|entity|database|collections|queue)\b/i.test(trimmed)) return [sequenceParticipant(trimmed)];
    const arrow = sequenceArrow(trimmed);
    if (arrow) return [arrow];
    if (/^(activate|deactivate|destroy|note\b|alt\b|else\b|opt\b|loop\b|par\b|and\b|critical\b|break\b|end\b)/i.test(trimmed)) return [trimmed];
    throw new Error(`未対応のPlantUMLシーケンス命令です: ${trimmed}`);
  });
  return { kind: "sequence", mermaid: ["sequenceDiagram", ...body.map((line) => `  ${line}`)].join("\n") };
}

function convertClass(lines: string[]): PlantUmlConversion {
  const body = lines.flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || /^title\b/i.test(trimmed)) return [];
    if (/^(class|interface|enum|abstract\s+class|annotation)\b/i.test(trimmed)) return [trimmed.replace(/^annotation\b/i, "class")];
    if (/^[\w."']+\s+(?:<\|--|--\|>|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.)\s+[\w."']+(?:\s*:\s*.*)?$/.test(trimmed)) return [trimmed];
    if (/^[{}]|^[-+#~]\S/.test(trimmed)) return [trimmed];
    throw new Error(`未対応のPlantUMLクラス命令です: ${trimmed}`);
  });
  return { kind: "class", mermaid: ["classDiagram", ...body.map((line) => `  ${line}`)].join("\n") };
}

function convertActivity(lines: string[]): PlantUmlConversion {
  const labels: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^(start|stop|end|title\b)/i.test(trimmed)) continue;
    const activity = trimmed.match(/^:(.*);$/)?.[1]?.trim();
    if (!activity) throw new Error(`未対応のPlantUMLアクティビティ命令です: ${trimmed}`);
    labels.push(activity);
  }
  if (labels.length === 0) throw new Error("PlantUMLアクティビティがありません。");
  const nodes = labels.map((label, index) => `  n${index}["${label.replace(/["\\]/g, "\\$&")}"]`);
  const edges = labels.slice(1).map((_, index) => `  n${index} --> n${index + 1}`);
  return { kind: "activity", mermaid: ["flowchart TD", ...nodes, ...edges].join("\n") };
}

/** Converts a safe, local PlantUML subset to the bundled Mermaid renderer. */
export function plantUmlToMermaid(source: string): PlantUmlConversion {
  const lines = sourceLines(source);
  if (lines.some((line) => /^\s*(class|interface|enum|abstract\s+class|annotation)\b/i.test(line) || /(?:<\|--|\*--|o--)/.test(line))) return convertClass(lines);
  if (lines.some((line) => /^\s*(start|stop|:.*;)\s*$/i.test(line))) return convertActivity(lines);
  if (lines.some((line) => /^\s*(participant|actor|boundary|control|entity|database|collections|queue)\b/i.test(line) || sequenceArrow(line.trim()))) return convertSequence(lines);
  throw new Error("対応するPlantUML図種を判定できません。シーケンス図、クラス図、または基本アクティビティ図を指定してください。");
}
