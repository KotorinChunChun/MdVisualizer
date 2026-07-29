import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PresentationView } from "./PresentationView";

const props = {
  baseDir: "C:\\docs",
  imageVersions: {},
  onStartCrop: () => {},
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
});
