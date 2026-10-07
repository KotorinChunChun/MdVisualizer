import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSearch } from "./useSearch";
import { SearchBar } from "../components/SearchBar";
import { SearchResults } from "../components/SearchResults";

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll); else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView; });
function Host({ content, initialPreview = false, reversed = false }: { content: string; initialPreview?: boolean; reversed?: boolean }) {
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(initialPreview), search = useSearch(root, "B03-source", undefined, String(preview), content);
  return <>
    <SearchBar search={search} inputRef={input} onClose={search.clear} />
    <SearchResults results={search.results} activeIndex={search.activeIndex} truncated={search.truncated} onSelect={search.setActiveIndex} onActivate={result => search.setActiveIndex(result.index)} />
    <output data-testid="count">{search.resultCount}</output><output data-testid="index">{search.activeIndex}</output>
    <button onClick={() => setPreview(value => !value)}>表示切替</button>
    {preview && <div ref={root} data-testid="preview">{reversed ? <><p data-source-line="3">term second</p><p data-source-line="1">term first</p></> : <p data-source-line="3">term visible</p>}</div>}
  </>;
}
const query = (text: string) => fireEvent.change(screen.getByRole("textbox", { name: "検索キーワードを入力" }), { target: { value: text } });
const count = (expected: number) => waitFor(() => expect(screen.getByTestId("count").textContent).toBe(String(expected)));

describe("B03-E06追補: ソース検索と表示DOMの境界", () => {
  it("コードだけでもソース2件を数え、次/前/Enterの選択が一覧と一致する", async () => {
    render(<Host content={"term first\n\nterm second"} />); query("term");
    await waitFor(() => expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(2));
    await count(2);
    expect((screen.getByRole("button", { name: "次の検索結果" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(screen.getByRole("listbox")).getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "次の検索結果" }));
    expect(within(screen.getByRole("listbox")).getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(screen.getByTestId("index").textContent).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "前の検索結果" }));
    expect(screen.getByTestId("index").textContent).toBe("1");
  });

  it("DOMにない画像のalt/path一致を別の本文markへ誤対応せず表示切替でも件数を保つ", async () => {
    const scroll = vi.fn(); Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    render(<Host content={"![term](term.png)\n\nterm visible"} initialPreview />); query("term");
    await waitFor(() => expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(3));
    await count(3);
    expect(document.querySelectorAll("mark[data-markdown-search]")).toHaveLength(1);
    expect(document.querySelector("mark[data-active='true']")).toBeNull(); expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "次の検索結果" }));
    expect(document.querySelector("mark[data-active='true']")).toBeNull(); expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "次の検索結果" }));
    expect(document.querySelector("mark[data-active='true']")?.closest("[data-source-line]")?.getAttribute("data-source-line")).toBe("3");
    expect(scroll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "表示切替" })); await count(3); expect(screen.getByTestId("index").textContent).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "表示切替" })); await count(3);
    await waitFor(() => expect(document.querySelector("mark[data-active='true']")).not.toBeNull());
    expect(within(screen.getByRole("listbox")).getAllByRole("option")[2].getAttribute("aria-selected")).toBe("true");
  });

  it("DOMの並びが異なってもnative highlightはsource行を照合して同じ結果を強調する", async () => {
    const highlights = new Map<string, { ranges: Range[] }>();
    class Highlight { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges; } }
    vi.stubGlobal("CSS", { highlights }); vi.stubGlobal("Highlight", Highlight);
    const scroll = vi.fn(); Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    const { unmount } = render(<Host content={"term first\n\nterm second"} initialPreview reversed />); query("term"); await count(2);
    const activeLine = () => highlights.get("markdown-search-B03-source-active")?.ranges[0]?.startContainer.parentElement?.closest("[data-source-line]")?.getAttribute("data-source-line");
    await waitFor(() => expect(activeLine()).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: "次の検索結果" }));
    expect(activeLine()).toBe("3"); expect(within(screen.getByRole("listbox")).getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
    unmount(); expect(highlights.size).toBe(0);
  });

  it("previewがなくても不正regexを0件にし修正・空検索へ回復する", async () => {
    render(<Host content={"term first\n\nterm second"} />);
    fireEvent.click(screen.getByLabelText(".*")); query("[");
    await waitFor(() => expect(screen.getByRole("search").textContent).toContain("正規表現エラー")); await count(0);
    query("term"); await count(2); expect(screen.getByTestId("index").textContent).toBe("0");
    query(""); await count(0); expect(screen.queryByRole("listbox")).toBeNull(); expect(screen.getByTestId("index").textContent).toBe("-1");
    expect(screen.getByRole("search").textContent).not.toContain("正規表現エラー");
  });
});
