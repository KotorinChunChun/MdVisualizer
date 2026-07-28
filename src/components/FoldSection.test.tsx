import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FoldSection } from "./FoldSection";

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
});
