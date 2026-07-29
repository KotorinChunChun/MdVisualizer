import { describe, expect, it } from "vitest";
import { DEFAULT_EXTERNAL_APPS, normalizeExternalApps, validateExternalApp } from "./settings";

describe("external app settings", () => {
  it("migrates missing settings to folder and VS Code buttons plus Notepad menu", () => {
    const apps = normalizeExternalApps(undefined);
    expect(apps.map(({ builtinKind, placement }) => [builtinKind, placement])).toEqual([
      ["folder", "primary"],
      ["vscode", "primary"],
      ["notepad", "menu"],
    ]);
  });

  it("repairs missing built-ins without losing custom applications", () => {
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
    expect(new Set(apps.map((app) => app.builtinKind).filter(Boolean))).toEqual(new Set(["folder", "vscode", "notepad"]));
  });

  it("rejects unknown placeholders", () => {
    expect(validateExternalApp({ ...DEFAULT_EXTERNAL_APPS[1], builtinKind: undefined, executable: "tool", args: ["${shell}"] }))
      .toContain("${shell}");
  });
});
