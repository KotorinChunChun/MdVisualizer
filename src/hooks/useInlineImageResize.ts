import { useCallback, useEffect, useRef, useState } from "react";

export const IMAGE_RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type ImageResizeHandle = (typeof IMAGE_RESIZE_HANDLES)[number];

export interface ImageSize { width: number; height: number; }

interface ResizeSession {
  pointerId: number;
  handle: ImageResizeHandle;
  startX: number;
  startY: number;
  startSize: ImageSize;
  aspectRatio: number;
  maxSize: ImageSize;
  displayScaleX: number;
  displayScaleY: number;
  captureTarget: HTMLElement;
}

interface UseInlineImageResizeOptions {
  /** Discards the uncontrolled size when the image source changes. */
  resetKey: string;
  minSize?: number;
  /** Controlled size for per-tab persistence. Omit for the existing local behaviour. */
  size?: ImageSize | null;
  /** Receives every size change when supplied, including the initial measured size. */
  onSizeChange?: (size: ImageSize) => void;
  /** Initial uncontrolled size, useful when a caller restores a tab state. */
  initialSize?: ImageSize | null;
}

const DEFAULT_MIN_SIZE = 48;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const isHorizontalHandle = (handle: ImageResizeHandle) => handle.includes("e") || handle.includes("w");
const isVerticalHandle = (handle: ImageResizeHandle) => handle.includes("n") || handle.includes("s");

function cssSize(element: HTMLElement): ImageSize | null {
  // offsetWidth/Height are layout (CSS) pixels.  The rect is affected by CSS zoom.
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  return width > 0 && height > 0 ? { width, height } : null;
}

export function useInlineImageResize({
  resetKey,
  minSize = DEFAULT_MIN_SIZE,
  size: controlledSize,
  onSizeChange,
  initialSize = null,
}: UseInlineImageResizeOptions) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const sessionRef = useRef<ResizeSession | null>(null);
  const maximumSizeRef = useRef<ImageSize | null>(null);
  const suppressClickRef = useRef(false);
  const suppressClickTimer = useRef<number | undefined>(undefined);
  const [uncontrolledSize, setUncontrolledSize] = useState<ImageSize | null>(initialSize);
  const [isResizing, setIsResizing] = useState(false);
  const size = controlledSize === undefined ? uncontrolledSize : controlledSize;

  const emitSize = useCallback((next: ImageSize) => {
    if (controlledSize === undefined) setUncontrolledSize(next);
    onSizeChange?.(next);
  }, [controlledSize, onSizeChange]);

  const clearSuppressionTimer = useCallback(() => {
    if (suppressClickTimer.current !== undefined) {
      window.clearTimeout(suppressClickTimer.current);
      suppressClickTimer.current = undefined;
    }
  }, []);

  const stopResize = useCallback(() => {
    const session = sessionRef.current;
    if (session?.captureTarget.hasPointerCapture?.(session.pointerId)) {
      session.captureTarget.releasePointerCapture?.(session.pointerId);
    }
    sessionRef.current = null;
    setIsResizing(false);
  }, []);

  useEffect(() => {
    maximumSizeRef.current = null;
    if (controlledSize === undefined) setUncontrolledSize(initialSize);
    stopResize();
    // A controlled size is updated on every pointer move.  It must not be an
    // effect dependency here: re-running this reset effect would end the
    // active drag after its first size change.  resetKey is the explicit
    // boundary for a new image/session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, stopResize]);

  useEffect(() => () => {
    clearSuppressionTimer();
    stopResize();
  }, [clearSuppressionTimer, stopResize]);

  const setInitialSize = useCallback(() => {
    const image = imageRef.current;
    if (!image) return;
    const measured = cssSize(image);
    if (!measured) return;
    maximumSizeRef.current = measured;
    // Do not overwrite a caller-restored controlled/initial value.  The measured
    // value is retained as the immutable upper bound for shrink-only resizing.
    if (!size) emitSize(measured);
  }, [emitSize, size]);

  const updateSize = useCallback((event: PointerEvent) => {
    const session = sessionRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    const horizontal = isHorizontalHandle(session.handle);
    const vertical = isVerticalHandle(session.handle);
    const dx = (event.clientX - session.startX) / session.displayScaleX;
    const dy = (event.clientY - session.startY) / session.displayScaleY;
    const xDirection = session.handle.includes("w") ? -1 : 1;
    const yDirection = session.handle.includes("n") ? -1 : 1;
    let width = session.startSize.width;
    let height = session.startSize.height;

    if (horizontal && vertical) {
      const widthScale = (width + dx * xDirection) / width;
      const heightScale = (height + dy * yDirection) / height;
      const scale = Math.min(1, Math.max(minSize / width, Math.min(widthScale, heightScale)));
      width = clamp(width * scale, minSize, session.maxSize.width);
      height = clamp(width / session.aspectRatio, minSize, session.maxSize.height);
    } else if (horizontal) {
      width = clamp(width + dx * xDirection, minSize, session.maxSize.width);
    } else if (vertical) {
      height = clamp(height + dy * yDirection, minSize, session.maxSize.height);
    }
    emitSize({ width, height });
  }, [emitSize, minSize]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => updateSize(event);
    const finish = (event: PointerEvent) => {
      if (!sessionRef.current || event.pointerId !== sessionRef.current.pointerId) return;
      stopResize();
      clearSuppressionTimer();
      suppressClickTimer.current = window.setTimeout(() => { suppressClickRef.current = false; suppressClickTimer.current = undefined; }, 0);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [clearSuppressionTimer, stopResize, updateSize]);

  const startResize = useCallback((handle: ImageResizeHandle, event: React.PointerEvent<HTMLElement>) => {
    const image = imageRef.current;
    const maxSize = maximumSizeRef.current;
    const startSize = size ?? (image ? cssSize(image) : null);
    if (!image || !maxSize || !startSize || event.button !== 0) return;
    const rect = image.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    clearSuppressionTimer();
    suppressClickRef.current = true;
    const captureTarget = event.currentTarget;
    captureTarget.setPointerCapture?.(event.pointerId);
    sessionRef.current = {
      pointerId: event.pointerId, handle, startX: event.clientX, startY: event.clientY,
      startSize, aspectRatio: startSize.width / startSize.height, maxSize,
      displayScaleX: rect.width / startSize.width,
      displayScaleY: rect.height / startSize.height,
      captureTarget,
    };
    setIsResizing(true);
  }, [clearSuppressionTimer, size]);

  const resizeFromKeyboard = useCallback((handle: ImageResizeHandle, event: React.KeyboardEvent<HTMLElement>) => {
    if (!event.key.startsWith("Arrow")) return;
    const image = imageRef.current;
    const current = size ?? (image ? cssSize(image) : null);
    const maxSize = maximumSizeRef.current;
    if (!current || !maxSize) return;
    event.preventDefault();
    const amount = event.shiftKey ? 24 : 8;
    // Arrow left/up reduces, right/down increases, but every path is capped at the initial size.
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const horizontal = isHorizontalHandle(handle);
    const vertical = isVerticalHandle(handle);
    if (horizontal && vertical) {
      const width = clamp(current.width + amount * direction, minSize, maxSize.width);
      emitSize({ width, height: clamp(width / (current.width / current.height), minSize, maxSize.height) });
    } else if (horizontal) emitSize({ ...current, width: clamp(current.width + amount * direction, minSize, maxSize.width) });
    else if (vertical) emitSize({ ...current, height: clamp(current.height + amount * direction, minSize, maxSize.height) });
  }, [emitSize, minSize, size]);

  const consumeResizeClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    clearSuppressionTimer();
    return true;
  }, [clearSuppressionTimer]);

  return { imageRef, size, isResizing, setInitialSize, startResize, resizeFromKeyboard, consumeResizeClick };
}
