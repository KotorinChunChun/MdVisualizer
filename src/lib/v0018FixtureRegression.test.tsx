import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import cases from "../../web-platform/tests/fixtures/v0.0.18-ui-cases.json";
import { DocumentDiffWorkspace } from "../components/DocumentDiffWorkspace";
import { parseDelimitedTable } from "./delimitedTable";

const sample = (id: string) => cases.cases.find((entry) => entry.id === id)!;
beforeAll(() => { Range.prototype.getClientRects = () => [] as unknown as DOMRectList; Range.prototype.getBoundingClientRect = () => new DOMRect(); });

describe("v0.0.18 UIサンプル回帰", () => {
  it("T01/T02の実fixtureを全行表示とヘッダOFFのABC列へ解析する", () => {
    const t01 = sample("T01").data as { longTsv: string };
    const long = parseDelimitedTable(t01.longTsv, "tsv", { hasHeader: true });
    expect(long.rows).toHaveLength(25);
    expect(long.rows[long.rows.length - 1]).toEqual(["項目25", "25"]);
    const t02 = sample("T02").data as { headerless: string };
    const noHeader = parseDelimitedTable(t02.headerless, "tsv", { hasHeader: false });
    expect(noHeader.headers).toEqual(["A", "B", "C"]);
    expect(noHeader.rows).toHaveLength(2);
  });
  it("D04の実fixtureで8行の一致部分を折畳む", () => {
    const data = sample("D04").data as { base: string; editing: string; storage: string };
    render(<DocumentDiffWorkspace target={{ path: "fixture.md", baseDir: ".", openedContent: data.base, editingContent: data.editing, storageContent: data.storage }} editorMode="edit" theme="light" />);
    expect(screen.getByRole("button", { name: /一致部分 8 行を表示/ })).toBeTruthy();
  });
});
