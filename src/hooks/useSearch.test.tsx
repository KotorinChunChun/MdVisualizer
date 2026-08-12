import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { useSearch } from "./useSearch";

function Harness() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [refresh, setRefresh] = useState(0);
  const search = useSearch(rootRef, "main", undefined, String(refresh));
  return (
    <>
      <button onClick={() => search.setQuery("alpha")}>search</button>
      <button onClick={search.previous}>previous</button>
      <button onClick={search.next}>next</button>
      <button onClick={() => setRefresh((value) => value + 1)}>refresh</button>
      <button onClick={search.clear}>clear</button>
      <output>{search.resultCount}</output>
      <div ref={rootRef}>Alpha beta alpha</div>
    </>
  );
}

function HighlightedCodeHarness() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [refresh, setRefresh] = useState(0);
  const [highlighted, setHighlighted] = useState(false);
  const search = useSearch(rootRef, "code", undefined, String(refresh));
  return (
    <>
      <button onClick={() => search.setQuery("cargo")}>cargo</button>
      <button onClick={() => search.setQuery("car")}>car</button>
      <button onClick={search.clear}>clear</button>
      <button onClick={() => { setHighlighted(true); setRefresh((value) => value + 1); }}>highlight complete</button>
      <output>{search.resultCount}</output>
      <div ref={rootRef}><pre>{highlighted
        ? <code dangerouslySetInnerHTML={{ __html: '<span class="hljs-string">cargo cargo</span>' }} />
        : <code>cargo cargo</code>
      }</pre></div>
    </>
  );
}

describe("useSearch", () => {
  afterEach(cleanup);

  it("marks matching text and removes only its owned marks", () => {
    render(<Harness />);
    act(() => screen.getByRole("button", { name: "search" }).click());
    expect(screen.getAllByText(/alpha/i, { selector: "mark" })).toHaveLength(2);
    expect(screen.getByRole("status", { hidden: true }).textContent).toBe("2");
    expect(document.querySelector("mark[data-active='true']")?.textContent?.toLowerCase()).toBe("alpha");
    act(() => screen.getByRole("button", { name: "clear" }).click());
    expect(document.querySelectorAll("mark[data-markdown-search]")).toHaveLength(0);
  });

  it("moves between results and reapplies highlights after content refresh", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    render(<Harness />);
    act(() => screen.getByRole("button", { name: "search" }).click());
    const marks = screen.getAllByText(/alpha/i, { selector: "mark" });
    expect(marks[0].dataset.active).toBe("true");
    act(() => screen.getByRole("button", { name: "next" }).click());
    expect(marks[1].dataset.active).toBe("true");
    expect(scrollIntoView).toHaveBeenCalled();
    act(() => screen.getByRole("button", { name: "refresh" }).click());
    expect(screen.getAllByText(/alpha/i, { selector: "mark" })).toHaveLength(2);
    expect(document.querySelector("mark[data-active='true']")?.textContent?.toLowerCase()).toBe("alpha");
  });

  it("uses and cleans a namespaced native highlight registry when available", () => {
    const previousCss = globalThis.CSS;
    const highlights = new Map<string, unknown>();
    class FakeHighlight { constructor(..._ranges: Range[]) {} }
    Object.assign(globalThis, { CSS: { highlights }, Highlight: FakeHighlight });
    const { unmount } = render(<Harness />);
    act(() => screen.getByRole("button", { name: "search" }).click());
    expect(highlights.has("markdown-search-main")).toBe(true);
    expect(highlights.has("markdown-search-main-active")).toBe(true);
    expect(document.querySelectorAll("mark[data-markdown-search]")).toHaveLength(0);
    unmount();
    expect(highlights.has("markdown-search-main")).toBe(false);
    expect(highlights.has("markdown-search-main-active")).toBe(false);
    Object.assign(globalThis, { CSS: previousCss });
    delete (globalThis as unknown as { Highlight?: unknown }).Highlight;
  });

  it("reapplies short queries after async code highlighting and preserves its syntax DOM when closed", () => {
    render(<HighlightedCodeHarness />);
    act(() => screen.getByRole("button", { name: "cargo" }).click());
    expect(screen.getAllByText("cargo", { selector: "mark" })).toHaveLength(2);

    act(() => screen.getByRole("button", { name: "highlight complete" }).click());
    expect(document.querySelectorAll("code .hljs-string mark[data-markdown-search]")).toHaveLength(2);

    act(() => screen.getByRole("button", { name: "car" }).click());
    expect(screen.getAllByText("car", { selector: "mark" })).toHaveLength(2);
    expect(screen.getByRole("status", { hidden: true }).textContent).toBe("2");

    act(() => screen.getByRole("button", { name: "clear" }).click());
    expect(document.querySelector("code .hljs-string")?.textContent).toBe("cargo cargo");
    expect(document.querySelectorAll("mark[data-markdown-search]")).toHaveLength(0);
  });
});
