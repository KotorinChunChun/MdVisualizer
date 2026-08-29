import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/commands", () => ({
  readDocumentAsset: vi.fn().mockResolvedValue({ text: "a,b\n1,2", mediaType: "text/csv", base64: "", filename: "table.csv", source: "local", canEdit: true }),
  copyTextFile: vi.fn(),
  openContainingFolder: vi.fn(),
}));

import { ExternalDelimitedTableBlock } from "./ExternalDelimitedTableBlock";

describe("ExternalDelimitedTableBlock", () => {
  afterEach(cleanup);

  it("外部CSVを表として展開しファイル名と状態を表示する", async () => {
    render(<ExternalDelimitedTableBlock source="table.csv" baseDir="C:\\docs" documentPath="C:\\docs\\note.md" language="csv" version={1} />);
    await waitFor(() => expect(screen.getByRole("table")).not.toBeNull());
    expect(screen.getByText("table.csv")).not.toBeNull();
    expect(screen.getByText("更新あり")).not.toBeNull();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });
});
