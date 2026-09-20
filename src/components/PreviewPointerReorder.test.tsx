import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PreviewPointerReorder } from "./PreviewPointerReorder";

afterEach(cleanup);
it("ホバーで移動可能な対象だけを示し、離れたら消す", () => {
  const root = createRef<HTMLDivElement>();
  const { container } = render(<><div ref={root}><p data-source-line="1">first</p><p data-source-line="3">second</p></div><PreviewPointerReorder root={root} markdown={"first\n\nsecond"} enabled onChange={vi.fn()} /></>);
  const first = container.querySelector("p")!;
  fireEvent.pointerOver(first);
  expect(first.classList.contains("preview-block-reorder-hovered")).toBe(true);
  fireEvent.pointerOut(first);
  expect(first.classList.contains("preview-block-reorder-hovered")).toBe(false);
});
it("表のセルからドラッグするとヘッダーを保持して本文行を移動する", () => {
  const root = createRef<HTMLDivElement>();
  const change = vi.fn().mockReturnValue(true);
  const markdown = "| name |\n| --- |\n| first |\n| second |";
  const { container } = render(<><div ref={root}><table><tbody><tr data-source-line="3"><td>first</td></tr><tr data-source-line="4"><td>second</td></tr></tbody></table></div><PreviewPointerReorder root={root} markdown={markdown} enabled onChange={change} /></>);
  const rows = container.querySelectorAll("tr");
  rows.forEach((row, index) => { row.getBoundingClientRect = () => new DOMRect(0, index * 30, 200, 30); });
  const pointer = (type: string, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 10, clientY: y });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(rows[0].firstChild!, event);
  };
  pointer("pointerdown", 10);
  expect(rows[0].classList.contains("preview-block-reorder-picked")).toBe(true);
  pointer("pointermove", 58);
  pointer("pointerup", 58);
  expect(change).toHaveBeenCalledWith(markdown, "| name |\n| --- |\n| second |\n| first |");
});

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
