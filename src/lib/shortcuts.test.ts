import { describe, expect, it } from "vitest";
import { acceptAuxiliaryNavigation, isShortcutHelpShortcut, isZoomInShortcut } from "./shortcuts";

describe("keyboard shortcuts", () => {
  it("accepts Ctrl+semicolon as zoom-in without accepting Alt or Meta variants", () => {
    expect(isZoomInShortcut({ ctrlKey: true, altKey: false, metaKey: false, key: ";", code: "Semicolon" })).toBe(true);
    expect(isZoomInShortcut({ ctrlKey: true, altKey: true, metaKey: false, key: ";", code: "Semicolon" })).toBe(false);
  });

  it("recognizes Ctrl+? across key and physical Slash representations", () => {
    expect(isShortcutHelpShortcut({ ctrlKey: true, altKey: false, metaKey: false, shiftKey: true, key: "?", code: "Slash" })).toBe(true);
    expect(isShortcutHelpShortcut({ ctrlKey: true, altKey: false, metaKey: false, shiftKey: true, key: "/", code: "Slash" })).toBe(true);
  });

  it("rejects a duplicate auxiliary-button event in the same physical click window", () => {
    const first = acceptAuxiliaryNavigation({ button: -1, timestamp: 0 }, 3, 1000);
    expect(first.accepted).toBe(true);
    expect(acceptAuxiliaryNavigation(first.next, 3, 1100).accepted).toBe(false);
    expect(acceptAuxiliaryNavigation(first.next, 3, 1300).accepted).toBe(true);
  });
});
