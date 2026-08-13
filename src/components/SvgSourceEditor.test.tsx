import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SvgSourceEditor } from "./SvgSourceEditor";

const target = {
  documentPath: "spmd://contoso.sharepoint.com/sites/docs/Shared/readme.md",
  source: "diagram.svg",
  path: "spmd://contoso.sharepoint.com/sites/docs/Shared/diagram.svg",
  revision: "etag-1",
  mediaType: "image/svg+xml" as const,
  filename: "diagram.svg",
  svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
};

afterEach(cleanup);

describe("SvgSourceEditor", () => {
  it("sanitizes SVG before saving it", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<SvgSourceEditor target={target} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("SVG XML"), {
      target: { value: '<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script><path d="M1 1"/></svg>' },
    });
    fireEvent.click(screen.getByRole("button", { name: "SharePointへ保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).not.toContain("script");
    expect(onSave.mock.calls[0][0]).toContain("M1 1");
  });

  it("blocks invalid SVG XML", () => {
    render(<SvgSourceEditor target={target} onSave={vi.fn()} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("SVG XML"), { target: { value: "<svg><path></svg>" } });
    expect(screen.getByRole("alert")).not.toBeNull();
    expect((screen.getByRole("button", { name: "SharePointへ保存" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
