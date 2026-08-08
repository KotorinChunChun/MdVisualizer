import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderSearchResultMatch, SearchResults } from "./SearchResults";

const result = { index: 0, line: 3, column: 1, headingPath: ["見出し"], match: "needle", before: [], text: "needle", after: [] };

describe("SearchResults", () => {
  it("activates the selected result with Enter", () => {
    const onActivate = vi.fn();
    render(<SearchResults results={[result]} activeIndex={0} truncated={false} onSelect={vi.fn()} onActivate={onActivate} />);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });
    expect(onActivate).toHaveBeenCalledWith(result);
  });

  it("moves the selection with arrow keys", () => {
    const onSelect = vi.fn();
    const { container } = render(<SearchResults results={[result, { ...result, index: 1, line: 4 }]} activeIndex={0} truncated={false} onSelect={onSelect} onActivate={vi.fn()} />);
    fireEvent.keyDown(container.querySelector("[role='listbox']")!, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("uses the result column and captured match without interpreting HTML", () => {
    const { container } = render(<SearchResults results={[{ ...result, column: 9, match: "NEEDLE", text: "needle <NEEDLE> needle" }]} activeIndex={0} truncated={false} onSelect={vi.fn()} onActivate={vi.fn()} />);
    const mark = container.querySelector(".search-results__match");
    expect(mark?.textContent).toBe("NEEDLE");
    expect(mark?.tagName).toBe("MARK");
    expect(container.querySelector("needle")).toBeNull();
  });

  it("highlights the specific occurrence for repeated matches", () => {
    const { container } = render(<>{renderSearchResultMatch("needle needle", 8, "needle")}</>);
    const mark = container.querySelector("mark");
    expect(mark?.textContent).toBe("needle");
    expect(mark?.previousSibling?.textContent).toBe("needle ");
  });
});
