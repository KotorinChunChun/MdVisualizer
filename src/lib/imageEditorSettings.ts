export interface ImageEditorSettings {
  normalWheelStep: number;
  fastWheelStep: number;
  fastWheelWindowMs: number;
}

export interface WheelSequenceState {
  count: number;
  lastTimestamp: number | null;
}

export const DEFAULT_IMAGE_EDITOR_SETTINGS: ImageEditorSettings = {
  normalWheelStep: 2,
  fastWheelStep: 10,
  fastWheelWindowMs: 300,
};

export const IMAGE_EDITOR_SETTINGS_KEY = "mdvisualizer.image-editor-settings.v1";

const positiveNumber = (value: unknown, fallback: number, maximum: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(1, parsed)) : fallback;
};

export function normalizeImageEditorSettings(value: Partial<ImageEditorSettings> | null | undefined): ImageEditorSettings {
  return {
    normalWheelStep: positiveNumber(value?.normalWheelStep, DEFAULT_IMAGE_EDITOR_SETTINGS.normalWheelStep, 90),
    fastWheelStep: positiveNumber(value?.fastWheelStep, DEFAULT_IMAGE_EDITOR_SETTINGS.fastWheelStep, 180),
    fastWheelWindowMs: positiveNumber(value?.fastWheelWindowMs, DEFAULT_IMAGE_EDITOR_SETTINGS.fastWheelWindowMs, 2_000),
  };
}

export function loadImageEditorSettings(storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): ImageEditorSettings {
  if (!storage) return { ...DEFAULT_IMAGE_EDITOR_SETTINGS };
  try {
    const saved = storage.getItem(IMAGE_EDITOR_SETTINGS_KEY);
    return saved ? normalizeImageEditorSettings(JSON.parse(saved) as Partial<ImageEditorSettings>) : { ...DEFAULT_IMAGE_EDITOR_SETTINGS };
  } catch {
    return { ...DEFAULT_IMAGE_EDITOR_SETTINGS };
  }
}

export function saveImageEditorSettings(settings: ImageEditorSettings, storage: Pick<Storage, "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage): ImageEditorSettings {
  const normalized = normalizeImageEditorSettings(settings);
  try {
    storage?.setItem(IMAGE_EDITOR_SETTINGS_KEY, JSON.stringify(normalized));
  } catch {
    // Restricted browser contexts may reject persistence; the live settings remain usable.
  }
  return normalized;
}

/** The third wheel event in a quick sequence switches to the configured fast step. */
export function nextWheelStep(
  previous: WheelSequenceState,
  timestamp: number,
  settings: ImageEditorSettings,
): { state: WheelSequenceState; step: number } {
  const continuous = previous.lastTimestamp !== null
    && timestamp >= previous.lastTimestamp
    && timestamp - previous.lastTimestamp <= settings.fastWheelWindowMs;
  const state = { count: continuous ? previous.count + 1 : 1, lastTimestamp: timestamp };
  return { state, step: state.count >= 3 ? settings.fastWheelStep : settings.normalWheelStep };
}
