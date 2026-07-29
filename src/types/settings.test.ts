import { describe, expect, it } from "vitest";
import { DEFAULT_EXTERNAL_APPS, DEFAULT_IMAGE_A4_TARGET_WIDTH, DEFAULT_IMAGE_EQUAL_PADDING, DEFAULT_PRESENTATION_LINE_THRESHOLD, normalizeExternalApps, normalizeImageA4TargetWidth, normalizeImageEqualPadding, normalizePresentationLineThreshold, validateExternalApp } from "./settings";

describe("external app settings", () => {
  it("provides document defaults and a direct Paint image action", () => {
    const apps = normalizeExternalApps(undefined);
    expect(apps.map(({ builtinKind, placement, target }) => [builtinKind, placement, target])).toEqual([
      ["folder", "primary", "document"],
      ["vscode", "primary", "document"],
      ["notepad", "menu", "document"],
      [undefined, "primary", "image"],
    ]);
    expect(apps.find((app) => app.id === "default-image-paint")).toMatchObject({ executable: "mspaint.exe", args: ["${file}"] });
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
    expect(apps.find((app) => app.id === "custom")?.target).toBe("document");
    expect(apps.some((app) => app.id === "default-image-paint")).toBe(true);
  });

  it("keeps explicitly configured image apps in the image section", () => {
    const apps = normalizeExternalApps([{
      id: "editor",
      label: "Editor",
      executable: "editor.exe",
      args: ["${file}"],
      workingDirectory: "${dir}",
      enabled: true,
      placement: "menu",
      order: 0,
      target: "image",
    }]);
    expect(apps.find((app) => app.id === "editor")?.target).toBe("image");
    expect(apps.some((app) => app.id === "default-image-paint")).toBe(false);
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

  it("normalizes image padding settings within their supported ranges", () => {
    expect(normalizeImageA4TargetWidth(4096)).toBe(4096);
    expect(normalizeImageA4TargetWidth(0)).toBe(DEFAULT_IMAGE_A4_TARGET_WIDTH);
    expect(normalizeImageA4TargetWidth(1.5)).toBe(DEFAULT_IMAGE_A4_TARGET_WIDTH);
    expect(normalizeImageEqualPadding(0)).toBe(0);
    expect(normalizeImageEqualPadding(48)).toBe(48);
    expect(normalizeImageEqualPadding(-1)).toBe(DEFAULT_IMAGE_EQUAL_PADDING);
  });
});
