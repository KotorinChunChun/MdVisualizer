export const ZOOM_LEVELS = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200] as const;

export type ZoomLevel = typeof ZOOM_LEVELS[number];

export function normalizeZoom(value: number): ZoomLevel {
  return ZOOM_LEVELS.reduce((nearest, candidate) =>
    Math.abs(candidate - value) < Math.abs(nearest - value) ? candidate : nearest,
  ZOOM_LEVELS[0]);
}

export function moveZoomLevel(current: number, direction: 1 | -1): number {
  const index = ZOOM_LEVELS.indexOf(normalizeZoom(current));
  return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index + direction))];
}
