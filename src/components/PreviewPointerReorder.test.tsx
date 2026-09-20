import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PreviewPointerReorder } from "./PreviewPointerReorder";

afterEach(cleanup);
it("マウス移動前の押下で移動対象を表示し、クリックだけでは本文を変更しない", () => {
  const root = createRef<HTMLDivElement>();
  const change = vi.fn();
  const { container } = render(<><div ref={root}><p data-source-line="1">first</p><p data-source-line="3">second</p></div><PreviewPointerReorder root={root} markdown={"first\n\nsecond"} enabled onChange={change} /></>);
  const first = container.querySelector("p")!;
  const pointer = (type: string) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0 });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(first, event);
  };
  pointer("pointerdown");
  expect(first.classList.contains("preview-block-reorder-picked")).toBe(true);
  expect(root.current!.classList.contains("preview-block-reorder-active")).toBe(false);
  pointer("pointerup");
  expect(first.classList.contains("preview-block-reorder-picked")).toBe(false);
  expect(change).not.toHaveBeenCalled();
});
