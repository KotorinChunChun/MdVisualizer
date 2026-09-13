import { describe, expect, it } from "vitest";
import { adoptProposalStableRow, createProposalStableState, editProposalStableState, proposalStableValue } from "./proposalDiff";

describe("行採否と手編集の対応", () => {
  it("途中の削除行を、手編集のあとも元の位置へ復旧する", () => {
    let state = createProposalStableState("head\ndeleted\ntail", "head\ntail");
    const row = state.rows.find(row => row.original === "deleted")!;
    state = editProposalStableState(state, "head\ntail edited");
    state = adoptProposalStableRow(state, row.id, "original");
    expect(proposalStableValue(state)).toBe("head\ndeleted\ntail edited");
    state = adoptProposalStableRow(state, row.id, "proposal");
    expect(proposalStableValue(state)).toBe("head\ntail edited");
  });
  it("複数行置換・行追加後、各行の不採用を順に選んでも原文の順序を保つ", () => {
    const original = "start\nA\nB\nC\nend";
    let state = createProposalStableState(original, "start\nX\nY\nend");
    state = editProposalStableState(state, "inserted\nstart\nX edited\nY\nend");
    expect(proposalStableValue(state)).toBe("inserted\nstart\nX edited\nY\nend");
    for (const row of [...state.rows].reverse()) state = adoptProposalStableRow(state, row.id, "original");
    expect(proposalStableValue(state)).toBe(original);
  });
  it("削除行を繰り返し採否しても重複挿入しない", () => {
    let state = createProposalStableState("a\nb\nc", "a\nc");
    const id = state.rows.find(row => row.original === "b")!.id;
    for (let n = 0; n < 3; n++) state = adoptProposalStableRow(state, id, "original");
    expect(proposalStableValue(state)).toBe("a\nb\nc");
    state = editProposalStableState(state, "a\nmanual\nc");
    state = adoptProposalStableRow(state, id, "proposal");
    expect(proposalStableValue(state)).toBe("a\nc");
  });
});
