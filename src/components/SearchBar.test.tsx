import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchBar } from "./SearchBar";

describe("SearchBar", () => {
  it("closes through its close button without requiring a search term", () => {
    const onClose = vi.fn();
    const search = { query: "", setQuery: vi.fn(), regex: false, setRegex: vi.fn(), caseSensitive: false, setCaseSensitive: vi.fn(), resultCount: 0, activeIndex: -1, setActiveIndex: vi.fn(), next: vi.fn(), previous: vi.fn(), error: null, results: [], truncated: false, contextLines: 2, setContextLines: vi.fn(), clear: vi.fn() };
    render(<SearchBar search={search} inputRef={{ current: null }} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "検索を閉じる" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
