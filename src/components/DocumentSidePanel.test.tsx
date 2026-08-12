import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSidePanel } from "./DocumentSidePanel";

describe("DocumentSidePanel", () => {
  afterEach(cleanup);

  it("offers one exclusive launcher for contents, search, and images", () => {
    const onTabChange = vi.fn();
    render(<DocumentSidePanel activeTab="toc" onTabChange={onTabChange} onClose={vi.fn()} toc={<p>toc body</p>} search={<p>search body</p>} images={<p>image body</p>} />);

    expect(screen.getByRole("button", { name: "目次パネル" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("toc body")).toBeTruthy();
    expect(screen.queryByText("search body")).toBeNull();
    expect(screen.queryByText("image body")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "検索パネル" }));
    expect(onTabChange).toHaveBeenLastCalledWith("search");
    fireEvent.click(screen.getByRole("button", { name: "目次パネル" }));
    expect(onTabChange).toHaveBeenLastCalledWith(null);
  });

  it("closes from both the header and narrow-width backdrop", () => {
    const onClose = vi.fn();
    render(<DocumentSidePanel activeTab="images" onTabChange={vi.fn()} onClose={onClose} toc={null} search={null} images={<p>images</p>} />);

    const closeButtons = screen.getAllByRole("button", { name: "サイドパネルを閉じる" });
    fireEvent.click(closeButtons[0]);
    fireEvent.click(closeButtons[1]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
