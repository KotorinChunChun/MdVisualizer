import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShortcutKeySvg } from "./ShortcutKeySvg";

describe("ShortcutKeySvg", () => {
  it("renders the common SVG builder as an inline keyboard shortcut", () => {
    const { container } = render(<ShortcutKeySvg source="Ctrl+S" variant="inline" />);
    const svg = container.querySelector("svg.shortcut-key-svg--inline");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-label")).toBe("キーボードショートカット: Ctrl + S");
    expect(container.querySelectorAll(".shortcut-key-svg__key")).toHaveLength(2);
  });

  it("renders a block variant with sequential groups", () => {
    const { container } = render(<ShortcutKeySvg source="Ctrl+K → Ctrl+C" variant="block" />);
    expect(container.querySelector("svg.shortcut-key-svg--block")).not.toBeNull();
    expect(container.querySelectorAll(".shortcut-key-svg__group")).toHaveLength(2);
    expect(container.textContent).toContain("→");
  });
});
