import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlantUmlBlock } from "./PlantUmlBlock";

vi.mock("./MermaidBlock", () => ({ MermaidBlock: ({ source }: { source: string }) => <output aria-label="変換済みPlantUML">{source}</output> }));

describe("PlantUmlBlock", () => {
  afterEach(cleanup);

  it("renders PlantUML content through the local Mermaid component", () => {
    render(<PlantUmlBlock source={"@startuml\nAlice -> Bob: hello\n@enduml"} theme="dark" mode="on" blockId="p1" />);
    expect(screen.getByLabelText("変換済みPlantUML").textContent).toContain("Alice->>Bob: hello");
    fireEvent.click(screen.getByRole("button", { name: "コード" }));
    expect(screen.getByText(/@startuml/)).toBeTruthy();
  });

  it("shows local conversion errors without attempting a remote render", () => {
    render(<PlantUmlBlock source={"!includeurl https://example.com/a.puml"} theme="dark" mode="on" blockId="p2" />);
    expect(screen.getByText("PlantUMLを描画できません。")).toBeTruthy();
    expect(screen.queryByLabelText("変換済みPlantUML")).toBeNull();
  });
});
