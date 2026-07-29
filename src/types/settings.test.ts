import { describe, expect, it } from "vitest";
import { DEFAULT_EXTERNAL_APPS, DEFAULT_PRESENTATION_LINE_THRESHOLD, normalizeExternalApps, normalizePresentationLineThreshold, validateExternalApp } from "./settings";

describe("external app settings", () => {
  it("migrates missing settings to folder and VS Code buttons plus Notepad menu", () => {
    const apps = normalizeExternalApps(undefined);
    expect(apps.map(({ builtinKind, placement }) => [builtinKind, placement])).toEqual([
      ["folder", "primary"],
      ["vscode", "primary"],
      ["notepad", "menu"],
    ]);
  });

  it("repairs the required Folder action without resurrecting optional presets", () => {
    const apps = normalizeExternalApps([{
      id: "custom",
      label: "Custom",
      executable: "C:/Tools/tool.exe",
      args: ["${file}"],
      placement: "primary",
      enabled: true,
      order: 0,
    }]);
    expect(apps.some((app) => app.id === "custom")).toBe(true);
    expect(new Set(apps.map((app) => app.builtinKind).filter(Boolean))).toEqual(new Set(["folder"]));
  });

  it("rejects unknown placeholders", () => {
    expect(validateExternalApp({ ...DEFAULT_EXTERNAL_APPS[1], builtinKind: undefined, executable: "tool", args: ["${shell}"] }))
      .toContain("${shell}");
  });

  it("normalizes the presentation source-line threshold", () => {
    expect(normalizePresentationLineThreshold(25)).toBe(25);
    expect(normalizePresentationLineThreshold(0)).toBe(DEFAULT_PRESENTATION_LINE_THRESHOLD);
    expect(normalizePresentationLineThreshold("10")).toBe(DEFAULT_PRESENTATION_LINE_THRESHOLD);
  });
});
