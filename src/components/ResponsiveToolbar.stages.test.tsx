import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { ResponsiveToolbar } from "./ResponsiveToolbar";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("幅に応じて全表示・編集を残す圧縮・全収納を往復する", () => {
  let width = 500;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function(this: HTMLElement) { return this.classList.contains("responsive-toolbar") ? width : 0; });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function(this: HTMLElement) { return this.textContent === "long commands" ? 200 : this.textContent === "コピー" ? 40 : 100; });
  const view = render(<ResponsiveToolbar threeStage ariaLabel="ブロック操作" items={[
    { id: "edit", node: <button>編集</button> },
    { id: "copy", node: <button>long commands</button>, compactNode: <button>コピー</button> },
  ]} />);
  const root = view.container.firstElementChild!;
  expect(root).toHaveAttribute("data-stage", "full");
  act(() => { width = 200; window.dispatchEvent(new Event("resize")); });
  expect(root).toHaveAttribute("data-stage", "compact");
  expect(screen.getByRole("button", { name: "編集" })).toBeVisible();
  expect(screen.getByRole("button", { name: "コピー" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "その他の操作" })).not.toBeInTheDocument();
  act(() => { width = 70; window.dispatchEvent(new Event("resize")); });
  expect(root).toHaveAttribute("data-stage", "menu");
  const moreButton = screen.getByRole("button", { name: "その他の操作" });
  expect(moreButton).toBeVisible();
  expect(moreButton).toHaveClass("diagram-action-button", "responsive-toolbar__more-button");
  expect(moreButton).toHaveAttribute("aria-expanded", "false");
  act(() => { width = 500; window.dispatchEvent(new Event("resize")); });
  expect(root).toHaveAttribute("data-stage", "full");
});
