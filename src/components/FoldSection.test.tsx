import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FoldSection } from "./FoldSection";

describe("FoldSection", () => {
  it("toggles its content and exposes the state to assistive technology", () => {
    render(<FoldSection><h2>Details</h2><div><p>Visible content</p></div></FoldSection>);
    const toggle = screen.getByRole("button", { name: /Details/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Visible content").closest("div[hidden]")).not.toBeNull();
  });
});
