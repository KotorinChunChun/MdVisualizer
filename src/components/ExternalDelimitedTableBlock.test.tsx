import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("外部TSVの編集ボタンから変更内容を保存コールバックへ渡す", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(<ExternalDelimitedTableBlock
      source="table.tsv"
      baseDir="C:\\docs"
      documentPath="C:\\docs\\note.md"
      language="tsv"
      version={0}
      onSave={onSave}
    />);
    await waitFor(() => expect(screen.getByRole("button", { name: "表を編集" })).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "表を編集" }));
    const dialog = screen.getByRole("dialog", { name: "表を編集" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "行 1 列 1" }), { target: { value: "updated" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "反映" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("a,b\nupdated"));
  });

  it("一時ステージ済みのTSVを優先表示して未保存状態にする", async () => {
    render(<ExternalDelimitedTableBlock
      source="table.tsv"
      baseDir="C:\\docs"
      documentPath="C:\\docs\\note.md"
      language="tsv"
      version={0}
      stagedSource={"name\tvalue\nstaged\t9"}
      onSave={() => true}
    />);

    expect(screen.getByText("未保存")).not.toBeNull();
    expect(screen.getByRole("table").textContent).toContain("staged");
  });

  it("外部表の非同期保存失敗では編集画面を閉じず、失敗を表示する", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("保存できません"));
    render(<ExternalDelimitedTableBlock source="table.csv" baseDir="C:\\docs" documentPath="C:\\docs\\note.md" language="csv" version={0} onSave={onSave} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "表を編集" })).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "表を編集" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "表を編集" })).getByRole("button", { name: "反映" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("保存できません"));
    expect(screen.getByRole("dialog", { name: "表を編集" })).not.toBeNull();
  });
});
