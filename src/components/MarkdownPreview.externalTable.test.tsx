import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./ExternalDelimitedTableBlock", () => ({
  ExternalDelimitedTableBlock: ({ source, stagedSource, onSave }: {
    source: string;
    stagedSource?: string;
    onSave?: (text: string) => void;
  }) => <span
    data-testid="external-table"
    data-source={source}
    data-staged-source={stagedSource}
  >
    {onSave && <button type="button" onClick={() => onSave("a\tb\n1\t2")}>外部表を変更</button>}
  </span>,
}));

import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview external table editing", () => {
  afterEach(cleanup);

  it("routes an external TSV edit with the document and source identity", () => {
    const onExternalTableChange = vi.fn();
    render(<MarkdownPreview
      content="![TSV](tables/data.tsv)"
      baseDir="/docs"
      documentPath="/docs/note.md"
      imageVersions={{}}
      stagedTableSources={{ "tables/data.tsv": "a\tb\nstaged\t9" }}
      onExternalTableChange={onExternalTableChange}
    />);

    expect(screen.getByTestId("external-table").dataset.stagedSource).toContain("staged");
    fireEvent.click(screen.getByRole("button", { name: "外部表を変更" }));
    expect(onExternalTableChange).toHaveBeenCalledWith({
      documentPath: "/docs/note.md",
      source: "tables/data.tsv",
      text: "a\tb\n1\t2",
    });
  });
});
