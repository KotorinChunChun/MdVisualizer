import { describe, expect, it } from "vitest";
import { emptyNavigationHistory, navigateBack, navigateForward, recordNavigation, type NavigationSnapshot } from "./navigationHistory";

const snapshot = (activeTabId: string): NavigationSnapshot => ({
  activeTabId,
  scrollTop: 0,
  viewMode: "auto",
  presentationHeadingId: null,
});

describe("navigation history", () => {
  it("moves snapshots backward and forward", () => {
    let history = recordNavigation(emptyNavigationHistory(), snapshot("a"));
    history = recordNavigation(history, snapshot("b"));
    const back = navigateBack(history, snapshot("c"));
    expect(back.target?.activeTabId).toBe("b");
    const backAgain = navigateBack(back.history, snapshot("b"));
    expect(backAgain.target?.activeTabId).toBe("a");
    const forward = navigateForward(backAgain.history, snapshot("a"));
    expect(forward.target?.activeTabId).toBe("b");
  });

  it("discards forward history after a new navigation", () => {
    const recorded = recordNavigation(emptyNavigationHistory(), snapshot("a"));
    const back = navigateBack(recorded, snapshot("b"));
    const branched = recordNavigation(back.history, snapshot("a"));
    expect(branched.forward).toEqual([]);
  });
});
