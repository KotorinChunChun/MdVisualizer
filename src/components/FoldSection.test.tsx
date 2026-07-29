import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FoldSection } from "./FoldSection";
import { dispatchFoldCommand } from "../lib/foldSections";

describe("FoldSection", () => {
  afterEach(cleanup);

  it("toggles its content and exposes the state to assistive technology", () => {
    render(<FoldSection><h2>Details</h2><div><p>Visible content</p></div></FoldSection>);
    const toggle = screen.getByRole("button", { name: /Details/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Visible content").closest("div[hidden]")).not.toBeNull();
  });

  it("responds to global fold-all commands", () => {
    render(<FoldSection><h2>Details</h2><div>Visible content</div></FoldSection>);
    const toggle = screen.getByRole("button", { name: /Details/ });
    act(() => window.dispatchEvent(new CustomEvent("markdown-fold-command", { detail: "collapse" })));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    act(() => window.dispatchEvent(new CustomEvent("markdown-fold-command", { detail: "expand" })));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("temporarily expands a collapsed section for search while preserving its stored state", () => {
    const { rerender } = render(<FoldSection foldId="details" collapsed><h2>Details</h2><div>Visible content</div></FoldSection>);
    expect(screen.getByRole("button", { name: /Details/ }).getAttribute("aria-expanded")).toBe("false");
    rerender(<FoldSection foldId="details" collapsed forceExpanded><h2>Details</h2><div>Visible content</div></FoldSection>);
    expect(screen.getByRole("button", { name: /Details/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("applies level, current-section, and reset commands", () => {
    render(<><FoldSection foldId="one"><h1>One</h1><div>One body</div></FoldSection><FoldSection foldId="two"><h2>Two</h2><div>Two body</div></FoldSection><FoldSection foldId="three"><h3>Three</h3><div>Three body</div></FoldSection></>);
    const [one, two, three] = screen.getAllByRole("button");
    act(() => dispatchFoldCommand("h1-only"));
    expect(one.getAttribute("aria-expanded")).toBe("true");
    expect(two.getAttribute("aria-expanded")).toBe("false");
    expect(three.getAttribute("aria-expanded")).toBe("false");
    act(() => window.dispatchEvent(new CustomEvent("markdown-fold-command", { detail: { command: "except-current", currentFoldId: "two" } })));
    expect(one.getAttribute("aria-expanded")).toBe("false");
    expect(two.getAttribute("aria-expanded")).toBe("true");
    expect(three.getAttribute("aria-expanded")).toBe("false");
    act(() => dispatchFoldCommand("reset"));
    expect(one.getAttribute("aria-expanded")).toBe("true");
    expect(two.getAttribute("aria-expanded")).toBe("true");
    expect(three.getAttribute("aria-expanded")).toBe("true");
  });

  it("toggles all sections based on their actual combined state", () => {
    render(<><FoldSection><h2>First</h2><div>First body</div></FoldSection><FoldSection><h2>Second</h2><div>Second body</div></FoldSection></>);
    const buttons = screen.getAllByRole("button");
    act(() => dispatchFoldCommand("toggle"));
    expect(buttons.every((button) => button.getAttribute("aria-expanded") === "false")).toBe(true);
    act(() => dispatchFoldCommand("toggle"));
    expect(buttons.every((button) => button.getAttribute("aria-expanded") === "true")).toBe(true);
  });
});
