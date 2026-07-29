import { describe, expect, it } from "vitest";
import {
  getMermaidStatus,
  resetMermaidStatusForTests,
  setMermaidBlockStatus,
  subscribeMermaidStatus,
} from "./mermaidStatus";

describe("mermaidStatus", () => {
  it("aggregates block states and notifies subscribers", () => {
    resetMermaidStatusForTests();
    const observed: number[] = [];
    const unsubscribe = subscribeMermaidStatus((status) => observed.push(status.errorCount));
    setMermaidBlockStatus("one", { state: "pending" });
    setMermaidBlockStatus("two", { state: "error", error: "bad syntax" });

    expect(getMermaidStatus()).toMatchObject({ pending: 1, error: 1, errorCount: 1 });
    expect(observed).toEqual([0, 0, 1]);
    unsubscribe();
  });
});
