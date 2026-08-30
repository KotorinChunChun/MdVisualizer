import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

  it("does not normalize React-managed text nodes while the query is empty", () => {
    const normalize = vi.spyOn(Node.prototype, "normalize");
    render(<Harness />);
    expect(normalize).not.toHaveBeenCalled();
    act(() => screen.getByRole("button", { name: "refresh" }).click());
    expect(normalize).not.toHaveBeenCalled();
    normalize.mockRestore();
  });

  it("marks matching text and removes only its owned marks", async () => {
    render(<Harness />);
    act(() => screen.getByRole("button", { name: "search" }).click());
    await waitFor(() => expect(screen.getAllByText(/alpha/i, { selector: "mark" })).toHaveLength(2));
    expect(screen.getByRole("status", { hidden: true }).textContent).toBe("2");
    await waitFor(() => expect(document.querySelector("mark[data-active='true']")?.textContent?.toLowerCase()).toBe("alpha"));
    act(() => screen.getByRole("button", { name: "clear" }).click());
    await waitFor(() => expect(document.querySelectorAll("mark[data-markdown-search]")).toHaveLength(0));
  });

  it("moves between results and reapplies highlights after content refresh", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    render(<Harness />);
    act(() => screen.getByRole("button", { name: "search" }).click());
    const marks = await waitFor(() => screen.getAllByText(/alpha/i, { selector: "mark" }));
    await waitFor(() => expect(marks[0].dataset.active).toBe("true"));
    act(() => screen.getByRole("button", { name: "next" }).click());
    await waitFor(() => expect(marks[1].dataset.active).toBe("true"));
    expect(scrollIntoView).toHaveBeenCalled();
    act(() => screen.getByRole("button", { name: "refresh" }).click());
    await waitFor(() => expect(screen.getAllByText(/alpha/i, { selector: "mark" })).toHaveLength(2));
    expect(document.querySelector("mark[data-active='true']")?.textContent?.toLowerCase()).toBe("alpha");
  });

  it("uses and cleans a namespaced native highlight registry when available", async () => {
    const previousCss = globalThis.CSS;
    const highlights = new Map<string, unknown>();
    class FakeHighlight { constructor(..._ranges: Range[]) {} }
    Object.assign(globalThis, { CSS: { highlights }, Highlight: FakeHighlight });
    const { unmount } = render(<Harness />);
    act(() => screen.getByRole("button", { name: "search" }).click());
    await waitFor(() => expect(highlights.has("markdown-search-main")).toBe(true));
    await waitFor(() => expect(highlights.has("markdown-search-main-active")).toBe(true));
    expect(document.querySelectorAll("mark[data-markdown-search]")).toHaveLength(0);
    unmount();
    expect(highlights.has("markdown-search-main")).toBe(false);
    expect(highlights.has("markdown-search-main-active")).toBe(false);
    Object.assign(globalThis, { CSS: previousCss });
    delete (globalThis as unknown as { Highlight?: unknown }).Highlight;
  });

  it("reapplies short queries after async code highlighting and preserves its syntax DOM when closed", async () => {
    render(<HighlightedCodeHarness />);
    act(() => screen.getByRole("button", { name: "cargo" }).click());
    await waitFor(() => expect(screen.getAllByText("cargo", { selector: "mark" })).toHaveLength(2));

    act(() => screen.getByRole("button", { name: "highlight complete" }).click());
    expect(document.querySelectorAll("code .hljs-string mark[data-markdown-search]")).toHaveLength(2);

    act(() => screen.getByRole("button", { name: "car" }).click());
    await waitFor(() => expect(screen.getAllByText("car", { selector: "mark" })).toHaveLength(2));
    expect(screen.getByRole("status", { hidden: true }).textContent).toBe("2");

    act(() => screen.getByRole("button", { name: "clear" }).click());
    expect(document.querySelector("code .hljs-string")?.textContent).toBe("cargo cargo");
    expect(document.querySelectorAll("mark[data-markdown-search]")).toHaveLength(0);
  });
});
