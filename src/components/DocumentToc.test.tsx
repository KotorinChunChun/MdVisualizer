import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentToc } from "./DocumentToc";

const markdown = "# 親見出し\n\n本文\n\n## 子見出し\n\n### 孫見出し\n\n## もう一つの子";

describe("DocumentToc", () => {
  afterEach(cleanup);

  it("renders the complete nested heading tree", () => {
    const { container } = render(<DocumentToc markdown={markdown} isOpen activeHeadingId="子見出し" onOpenChange={vi.fn()} onJump={vi.fn()} />);

    const navigation = screen.getByRole("navigation", { name: "文書全体の目次" });
    expect(navigation.querySelectorAll("li")).toHaveLength(4);
    expect(container.querySelectorAll(".document-toc ul")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "親見出し" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "孫見出し" })).toBeTruthy();
  });

  it("marks the active heading and delegates jumps", () => {
    const onJump = vi.fn();
    render(<DocumentToc markdown={markdown} isOpen activeHeadingId="子見出し" onOpenChange={vi.fn()} onJump={onJump} />);

    expect(screen.getByRole("button", { name: "子見出し" }).getAttribute("aria-current")).toBe("location");
    fireEvent.click(screen.getByRole("button", { name: "孫見出し" }));
    expect(onJump).toHaveBeenCalledWith("孫見出し");
  });

  it("uses the toggle, close button, and backdrop to request visibility changes", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<DocumentToc markdown={markdown} isOpen={false} onOpenChange={onOpenChange} onJump={vi.fn()} />);

    const toggle = screen.getByRole("button", { name: "☰ 目次" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    rerender(<DocumentToc markdown={markdown} isOpen onOpenChange={onOpenChange} onJump={vi.fn()} />);
    const closeControls = screen.getAllByRole("button", { name: "目次を閉じる" });
    fireEvent.click(closeControls[0]);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(closeControls[1]);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("renders reusable navigation without a second panel shell when embedded", () => {
    const { container } = render(<DocumentToc markdown={markdown} isOpen embedded onOpenChange={vi.fn()} onJump={vi.fn()} />);
    expect(container.querySelector(".document-toc--embedded")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "文書全体の目次" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "文書全体の目次" })).toBeNull();
  });

  it("moves a heading by keyboard only among siblings", () => {
    const onMove = vi.fn(() => true);
    render(<DocumentToc markdown={markdown} isOpen embedded onOpenChange={vi.fn()} onJump={vi.fn()} onMove={onMove} />);

    fireEvent.keyDown(screen.getByRole("button", { name: "子見出し" }), { key: "ArrowDown", altKey: true });
    expect(onMove).toHaveBeenCalledWith("子見出し", "もう一つの子", "after");
    expect(screen.getByText("子見出しを移動しました。")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("button", { name: "孫見出し" }), { key: "ArrowDown", altKey: true });
    expect(onMove).toHaveBeenCalledOnce();
  });

  it("shows an insertion marker during same-level dragging", () => {
    const onMove = vi.fn(() => true);
    const { container } = render(<DocumentToc markdown={markdown} isOpen embedded onOpenChange={vi.fn()} onJump={vi.fn()} onMove={onMove} />);
    const source = screen.getByRole("button", { name: "子見出し" });
    const target = screen.getByRole("button", { name: "もう一つの子" });
    Object.defineProperty(target, "getBoundingClientRect", { value: () => ({ top: 0, height: 20 }) });
    const dataTransfer = { effectAllowed: "none", dropEffect: "none", setData: vi.fn(), getData: vi.fn() };

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer, clientY: 18 });
    expect(container.querySelector("li.is-drop-after")).toBeTruthy();
    fireEvent.drop(target, { dataTransfer });
    expect(onMove).toHaveBeenCalledWith("子見出し", "もう一つの子", "after");
  });
});
