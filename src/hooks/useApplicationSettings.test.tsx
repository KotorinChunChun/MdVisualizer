import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MARKDOWN_STYLE_SETTINGS } from "../lib/markdownStyle";
import { DEFAULT_SYNTAX_HIGHLIGHT_SETTINGS } from "../lib/syntaxHighlight";
import { DEFAULT_EXTERNAL_APPS, DEFAULT_CLIPBOARD_IMAGE_SETTINGS, DEFAULT_EMBEDDED_PATH_STYLE, DEFAULT_IMAGE_A4_TARGET_WIDTH, DEFAULT_IMAGE_EQUAL_PADDING, DEFAULT_PRESENTATION_LINE_THRESHOLD } from "../types/settings";
import { useApplicationSettings } from "./useApplicationSettings";

const mocks = vi.hoisted(() => ({
  loadMarkdownStyle: vi.fn(),
  loadSettingsStatus: vi.fn(),
  openMarkdownStyle: vi.fn(),
  saveMarkdownStyle: vi.fn(),
  saveSettings: vi.fn(),
  updateExternalAppSettings: vi.fn(),
}));

vi.mock("../lib/commands", () => mocks);

describe("useApplicationSettings print migration", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }),
    });
    mocks.loadMarkdownStyle.mockResolvedValue({ css: "", path: "", revision: "" });
    mocks.saveSettings.mockResolvedValue({});
    mocks.loadSettingsStatus.mockResolvedValue({ settings: {
      theme: "system", zoom: 100, documentViewModes: {}, autoReload: "on", foldStates: {}, externalApps: DEFAULT_EXTERNAL_APPS,
      presentationLineThreshold: DEFAULT_PRESENTATION_LINE_THRESHOLD, imageA4TargetWidth: DEFAULT_IMAGE_A4_TARGET_WIDTH,
      imageEqualPadding: DEFAULT_IMAGE_EQUAL_PADDING, clipboardImage: DEFAULT_CLIPBOARD_IMAGE_SETTINGS,
      embeddedPathStyle: DEFAULT_EMBEDDED_PATH_STYLE, syntaxHighlight: DEFAULT_SYNTAX_HIGHLIGHT_SETTINGS,
      markdownStyle: DEFAULT_MARKDOWN_STYLE_SETTINGS,
      printStyle: { headingColor: "#1f2328", borderColor: "#d0d7de", backgroundColor: "#ffffff", fontFamily: "system", monochrome: false },
    }, recoveredFiles: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });

  it("persists defaults for metadata fields when loading the legacy print object", async () => {
    const setToast = vi.fn();
    const { result } = renderHook(() => useApplicationSettings(setToast));
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      printStyle: expect.objectContaining({ foldMode: "all", showTitle: true, showFilename: true, showDate: true }),
    })));
    expect(result.current.printStyle).toMatchObject({ foldMode: "all", showTitle: true, showFilename: true, showDate: true });
  });

  it("applies normalized print CSS variables without changing document view state", async () => {
    const setToast = vi.fn();
    const { result } = renderHook(() => useApplicationSettings(setToast));
    await act(async () => {});
    expect(document.documentElement.dataset.printMonochrome).toBe("false");
    expect(document.documentElement.style.getPropertyValue("--print-font-family")).toContain("system-ui");
    expect(result.current.documentViewModes).toEqual({});
  });
});
