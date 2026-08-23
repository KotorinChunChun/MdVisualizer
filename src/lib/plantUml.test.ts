import { describe, expect, it } from "vitest";
import { isPlantUmlFenceLanguage, plantUmlToMermaid } from "../../packages/markdown-core/src/plantUml";

describe("local PlantUML conversion", () => {
  it("recognizes both documented fence names", () => {
    expect(isPlantUmlFenceLanguage("plantuml")).toBe(true);
    expect(isPlantUmlFenceLanguage("PUML")).toBe(true);
    expect(isPlantUmlFenceLanguage("mermaid")).toBe(false);
  });

  it("converts a wrapped sequence diagram without a network URL", () => {
    const converted = plantUmlToMermaid("@startuml\nactor User\nparticipant API\nUser -> API: request\nAPI --> User: response\n@enduml");
    expect(converted.kind).toBe("sequence");
    expect(converted.mermaid).toContain("User->>API: request");
    expect(converted.mermaid).toContain("API-->>User: response");
    expect(converted.mermaid).not.toMatch(/https?:/);
  });

  it("converts class relationships and basic activities", () => {
    expect(plantUmlToMermaid("class Parent\nclass Child\nParent <|-- Child").mermaid).toContain("classDiagram");
    expect(plantUmlToMermaid("start\n:Read export;\n:Render page;\nstop").mermaid).toContain("n0 --> n1");
  });

  it("rejects includes instead of sending content elsewhere", () => {
    expect(() => plantUmlToMermaid("@startuml\n!includeurl https://example.com/a.puml\nA -> B\n@enduml")).toThrow("外部参照命令");
  });
});
