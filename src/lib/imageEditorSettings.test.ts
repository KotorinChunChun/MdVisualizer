import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_EDITOR_SETTINGS,
  IMAGE_EDITOR_SETTINGS_KEY,
  loadImageEditorSettings,
  nextWheelStep,
  normalizeImageEditorSettings,
  saveImageEditorSettings,
} from "./imageEditorSettings";

describe("image editor settings", () => {
  it("normalizes invalid persisted values", () => {
    expect(normalizeImageEditorSettings({ normalWheelStep: 0, fastWheelStep: 500, fastWheelWindowMs: Number.NaN })).toEqual({
      normalWheelStep: 1,
      fastWheelStep: 180,
      fastWheelWindowMs: DEFAULT_IMAGE_EDITOR_SETTINGS.fastWheelWindowMs,
    });
  });

  it("loads and saves normalized settings", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    saveImageEditorSettings({ normalWheelStep: 3, fastWheelStep: 12, fastWheelWindowMs: 250 }, storage);
    expect(JSON.parse(values.get(IMAGE_EDITOR_SETTINGS_KEY) ?? "{}")).toMatchObject({ normalWheelStep: 3, fastWheelStep: 12 });
    expect(loadImageEditorSettings(storage)).toEqual({ normalWheelStep: 3, fastWheelStep: 12, fastWheelWindowMs: 250 });
  });

  it("uses the fast step from the third quick event and resets after a pause", () => {
    const settings = DEFAULT_IMAGE_EDITOR_SETTINGS;
    let sequence = { count: 0, lastTimestamp: null as number | null };
    let result = nextWheelStep(sequence, 100, settings);
    expect(result.step).toBe(2);
    result = nextWheelStep(result.state, 200, settings);
    expect(result.step).toBe(2);
    result = nextWheelStep(result.state, 250, settings);
    expect(result.step).toBe(10);
    result = nextWheelStep(result.state, 700, settings);
    expect(result).toMatchObject({ step: 2, state: { count: 1 } });
  });
});
