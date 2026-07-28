import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useRef } from "react";
import { useSearch } from "./useSearch";

function Harness() {
  const rootRef = useRef<HTMLDivElement>(null);
  const search = useSearch(rootRef);
  return <><button onClick={() => search.setQuery("alpha")}>search</button><button onClick={search.clear}>clear</button><output>{search.resultCount}</output><div ref={rootRef}>Alpha beta alpha</div></>;
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
});
