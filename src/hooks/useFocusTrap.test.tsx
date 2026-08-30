import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { useFocusTrap } from "./useFocusTrap";

afterEach(cleanup);

function FocusTrapFixture({ onClose, initialOpen = false }: { onClose: () => void; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const rootRef = useFocusTrap<HTMLDivElement>(open, () => {
    onClose();
    setOpen(false);
  });

  return <>
    <button type="button" onClick={() => setOpen(true)}>起点</button>
    <button type="button">背面のボタン</button>
    {open && <div ref={rootRef} role="dialog" aria-modal="true" tabIndex={-1}>
      <button type="button">先頭</button>
      <button type="button">末尾</button>
    </div>}
  </>;
}

describe("useFocusTrap", () => {
  it("focuses the first control, cycles Tab, and keeps focus inside", () => {
    render(<FocusTrapFixture initialOpen onClose={() => {}} />);
    const first = screen.getByRole("button", { name: "先頭" });
    const last = screen.getByRole("button", { name: "末尾" });
    const outside = screen.getByRole("button", { name: "背面のボタン" });

    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab" });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    outside.focus();
    expect(document.activeElement).toBe(first);
  });

  it("closes on Escape and restores focus to the opener", () => {
    const onClose = vi.fn();
    render(<FocusTrapFixture onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "起点" });
    opener.focus();
    fireEvent.click(opener);
    const first = screen.getByRole("button", { name: "先頭" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
