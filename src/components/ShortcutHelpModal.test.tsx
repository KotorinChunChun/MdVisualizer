import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutHelpModal } from "./ShortcutHelpModal";

describe("ShortcutHelpModal", () => {
  afterEach(cleanup);

  it("lists the new shortcuts and closes with Escape", () => {
    const onClose = vi.fn();
    render(<ShortcutHelpModal onClose={onClose} />);
    expect(screen.getByText("Ctrl + + / Ctrl + ;")).toBeTruthy();
    expect(screen.getByText("Ctrl + ?")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
