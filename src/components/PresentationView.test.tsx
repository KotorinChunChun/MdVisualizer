import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresentationView, shouldHandlePresentationArrowKey } from "./PresentationView";

const props = {
  baseDir: "C:\\docs",
  imageVersions: {},
  theme: "dark",
  mermaidMode: "off" as const,
  windowId: "main",
  tabId: "tab-1",
  imageDisplaySizes: {},
};

describe("PresentationView", () => {
  afterEach(cleanup);

  it("navigates multiple children as separate pages", () => {
    render(<PresentationView {...props} content={"# Parent\nintro\n\n## One\nbody\n\n## Two\nbody"} />);

    expect(screen.getByText("1 / 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Two/ }));
    expect(screen.getByText("3 / 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Parent (1/1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Two (2/2)" })).toBeTruthy();
  });

  it("uses arrow keys for sequential navigation", () => {
    render(<PresentationView {...props} content={"# Parent\n\n## A\nlong\nline\n\n## B\nlong\nline"} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("2 / 3")).toBeTruthy();
  });

  it("does not steal arrows from controls, horizontal content, or modal dialogs", () => {
    render(<PresentationView {...props} content={"# Parent\n\n## A\nbody\n\n## B\nbody"} />);
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(screen.getByText("1 / 3")).toBeTruthy();

    const scroller = document.createElement("div");
    scroller.className = "table-scroll";
    Object.defineProperties(scroller, { clientWidth: { value: 100 }, scrollWidth: { value: 200 } });
    document.body.append(scroller);
    fireEvent.keyDown(scroller, { key: "ArrowRight" });
    expect(screen.getByText("1 / 3")).toBeTruthy();

    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    document.body.append(modal);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("1 / 3")).toBeTruthy();
    modal.remove();
    scroller.remove();
    input.remove();
  });

  it("identifies a normal presentation arrow key as navigable", () => {
    const event = new KeyboardEvent("keydown", { key: "ArrowRight" });
    expect(shouldHandlePresentationArrowKey(event)).toBe(true);
  });

  it("does not render the removed presentation-specific table of contents", () => {
    render(<PresentationView {...props} content={"# Parent\nintro\n\n## One\nbody\n\n## Two\nbody"} />);
    expect(screen.queryByRole("button", { name: /目次/ })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "文書全体の目次" })).toBeNull();
  });

  it("uses the same child-heading model and order for the read-only print pages", () => {
    const { container } = render(<PresentationView {...props} content={"# Parent\nintro\n\n## One\nbody\n\n## Two\nbody"} />);

    const screenChildren = container.querySelector(".presentation-stage .presentation-children");
    const printChildren = container.querySelector(".presentation-print-page .presentation-children--print");
    expect(Array.from(screenChildren!.querySelectorAll("button span:first-child"), (element) => element.textContent)).toEqual(["One", "Two"]);
    expect(Array.from(printChildren!.querySelectorAll("li"), (element) => element.textContent)).toEqual(["One", "Two"]);
    expect(printChildren!.querySelectorAll("button")).toHaveLength(0);
  });

  it("does not report the stale page while an external history position is restored", () => {
    const onPageChange = vi.fn();
    const content = "# Parent\nintro\n\n## One\nbody\n\n## Two\nbody";
    const { rerender } = render(<PresentationView {...props} content={content} initialHeadingId="parent" onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Two/ }));
    expect(screen.getByText("3 / 3")).toBeTruthy();
    onPageChange.mockClear();

    rerender(<PresentationView {...props} content={content} initialHeadingId="one" onPageChange={onPageChange} />);

    expect(screen.getByText("2 / 3")).toBeTruthy();
    expect(onPageChange.mock.calls.some(([headingId]) => headingId === "two")).toBe(false);
    expect(onPageChange).toHaveBeenLastCalledWith("one", expect.any(Number));
  });
});
