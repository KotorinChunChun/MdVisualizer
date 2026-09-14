import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  copyMermaid: vi.fn(),
  copyMermaidAsFile: vi.fn(),
}));

vi.mock("../lib/mermaidClipboard", () => ({
  copyMermaid: mocks.copyMermaid,
  copyMermaidAsFile: mocks.copyMermaidAsFile,
}));

import { MermaidToolbar } from "./MermaidToolbar";

afterEach(cleanup);
beforeEach(() => {
  mocks.copyMermaid.mockReset().mockResolvedValue(undefined);
  mocks.copyMermaidAsFile.mockReset().mockResolvedValue("C:/temp/drawio.drawio");
});

describe("MermaidToolbar", () => {
  it.each([
    ["ベクターイメージとしてコピー", "SVGファイルとしてコピー", "svg"],
    ["ビットマップイメージとしてコピー", "ビットマップファイルとしてコピー", "bmp"],
  ])("offers the corresponding file action after %s", async (command, label, kind) => {
    let detail: { actions?: { label: string; onAction: () => Promise<void> }[] } | undefined;
    const listener = (event: Event) => { detail = (event as CustomEvent).detail; };
    window.addEventListener("markdown-toast", listener);
    try {
      render(<MermaidToolbar source="flowchart LR" svg="<svg/>" display="diagram" />);
      fireEvent.click(screen.getByRole("button", { name: "コピー形式を選択" }));
      fireEvent.click(screen.getByRole("button", { name: command }));
      await waitFor(() => expect(detail?.actions?.[0].label).toBe(label));
      await detail!.actions![0].onAction();
      expect(mocks.copyMermaidAsFile).toHaveBeenCalledWith(kind, "flowchart LR", "<svg/>", "mermaid");
      expect(detail?.actions).toBeUndefined();
    } finally { window.removeEventListener("markdown-toast", listener); }
  });
  it("offers all draw.io copy forms in the single menu", async () => {
    let toastDetail: { message?: string } | undefined;
    const listener = (event: Event) => { toastDetail = (event as CustomEvent).detail; };
    window.addEventListener("markdown-toast", listener);
    render(<MermaidToolbar
      source="<mxfile/>"
      svg='<svg viewBox="0 0 10 10"/>'
      display="diagram"
      fileDiagramKind="drawio"
    />);

    fireEvent.click(screen.getByRole("button", { name: "コピー形式を選択" }));
    expect(screen.getByRole("button", { name: "コードテキストをコピー" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ベクターイメージとしてコピー" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ビットマップイメージとしてコピー" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "draw.ioファイルとしてコピー" }));

    await waitFor(() => expect(toastDetail?.message).toBe("ファイルを保存しました"));

    expect(mocks.copyMermaidAsFile).toHaveBeenCalledWith(
      "code",
      "<mxfile/>",
      '<svg viewBox="0 0 10 10"/>',
      "drawio",
    );
    window.removeEventListener("markdown-toast", listener);
  });

  it("writes SVG files as SVG instead of Mermaid source", async () => {
    render(<MermaidToolbar source={"flowchart LR\nA-->B"} svg='<svg viewBox="0 0 10 10"/>' display="diagram" />);
    fireEvent.click(screen.getByRole("button", { name: "コピー形式を選択" }));
    fireEvent.click(screen.getByRole("button", { name: "SVGファイルとしてコピー" }));
    await waitFor(() => expect(mocks.copyMermaidAsFile).toHaveBeenCalledWith("svg", "flowchart LR\nA-->B", '<svg viewBox="0 0 10 10"/>', "mermaid"));
  });

  it("uses a PNG clipboard image when native BMP is unavailable", async () => {
    render(<MermaidToolbar source="flowchart LR" svg='<svg viewBox="0 0 10 10"/>' display="diagram" allowBitmapCopy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "コピー形式を選択" }));
    const bitmap = screen.getByRole("button", { name: "ビットマップイメージとしてコピー" });
    expect(bitmap).not.toHaveProperty("disabled", true);
    fireEvent.click(bitmap);
    await waitFor(() => expect(mocks.copyMermaid).toHaveBeenCalledWith("png", "flowchart LR", '<svg viewBox="0 0 10 10"/>'));
  });
});
