import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useDocumentOpenShortcut } from "./useDocumentOpenShortcut";
afterEach(cleanup);
function press(options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key:"o", ctrlKey:true, cancelable:true, ...options });
  window.dispatchEvent(event); return event;
}
it("Ctrl+Oで選択を一度だけ開き、完了するまで二重起動を防ぐ", async () => {
  let complete!: () => void;
  const open = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  renderHook(() => useDocumentOpenShortcut(open, true));
  expect(press().defaultPrevented).toBe(true); press(); press({ repeat:true });
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => { complete(); });
  press(); expect(open).toHaveBeenCalledTimes(2);
});
it("印刷やモーダル中は開かず、修飾違いや解除後に残ったlistenerにも反応しない", () => {
  const open = vi.fn(async () => undefined);
  const {unmount} = renderHook(() => useDocumentOpenShortcut(open, false));
  expect(press().defaultPrevented).toBe(true);
  expect(press({ altKey:true }).defaultPrevented).toBe(false);
  expect(press({ ctrlKey:false }).defaultPrevented).toBe(false);
  expect(press({ shiftKey:true }).defaultPrevented).toBe(false);
  expect(open).not.toHaveBeenCalled();unmount();press();expect(open).not.toHaveBeenCalled();
});
