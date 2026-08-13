import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DrawioBlock } from "./DrawioBlock";

vi.mock("./MermaidBlock", () => ({ MermaidBlock: ({ source }: { source: string }) => <div data-testid="mermaid-drawio">{source}</div> }));

describe("DrawioBlock", () => {
  afterEach(cleanup);

  it("previews SVG safely and opens the editor with conversion warnings", () => {
    const onSave = vi.fn();
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/><path d="M0 0L1 1"/><script>alert(1)</script></svg>';
    const { container } = render(<DrawioBlock source={source} theme="light" blockId="one" onSave={onSave} />);
    expect(container.innerHTML).not.toContain("script");
    expect(screen.getByText("SVG → draw.io")).toBeTruthy();
    const editButton = screen.getByRole("button", { name: "編集" });
    expect(editButton.classList.contains("diagram-action-button")).toBe(true);
    fireEvent.click(editButton);
    expect(screen.getByRole("dialog", { name: "draw.io図の編集" })).toBeTruthy();
    expect(screen.getByText(/<path>/)).toBeTruthy();
  });

  it("uses the Mermaid preview for draw.io Mermaid sources", () => {
    render(<DrawioBlock source={"flowchart LR\nA-->B"} theme="dark" blockId="two" />);
    expect(screen.getByTestId("mermaid-drawio").textContent).toContain("A-->B");
    expect(screen.queryByRole("button", { name: "編集" })).toBeNull();
  });
});
