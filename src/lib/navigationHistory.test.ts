import { describe, expect, it } from "vitest";
import { emptyNavigationHistory, navigateBack, navigateForward, recordNavigation, type NavigationSnapshot } from "./navigationHistory";

const snapshot = (activeTabId: string): NavigationSnapshot => ({
  activeTabId,
  scrollTop: 0,
  viewMode: "auto",
  presentationHeadingId: null,
  editorMode: "split",
  editorLine: 12,
  scrollAnchor: null,
  mediaPreview: null,
  mediaView: null,
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

  it("keeps pane, semantic scroll, and media preview state in a bounded history", () => {
    const rich = {
      ...snapshot("a"),
      editorMode: "edit" as const,
      scrollAnchor: { blockId: "b", foldId: "f", text: "text", sourceLine: 8, viewportOffset: 4, scrollRatio: 0.5 },
      mediaPreview: { content: { kind: "image" as const, src: "image.png", alt: "image" } },
      mediaView: { mode: "actual" as const, scale: 2, display: "diagram" as const, scrollLeft: 120, scrollTop: 80 },
    };
    let history = emptyNavigationHistory();
    for (let index = 0; index < 105; index += 1) history = recordNavigation(history, { ...rich, scrollTop: index });
    expect(history.back).toHaveLength(100);
    expect(history.back[history.back.length - 1]).toMatchObject({ editorMode: "edit", editorLine: 12, mediaView: { scale: 2 }, scrollAnchor: { sourceLine: 8 } });
  });
});
