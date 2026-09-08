export interface CropBox { x: number; y: number; w: number; h: number; }
export type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

export function cropPixels(box: CropBox, naturalSize: { w: number; h: number }) {
  return {
    x: Math.round((box.x / 100) * naturalSize.w),
    y: Math.round((box.y / 100) * naturalSize.h),
    width: Math.round((box.w / 100) * naturalSize.w),
    height: Math.round((box.h / 100) * naturalSize.h),
  };
}

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

/** Resizes a percentage crop box; Ctrl-style symmetric mode keeps its center fixed. */
export function resizeCropBox(
  start: CropBox,
  handle: CropHandle,
  dx: number,
  dy: number,
  minimum: { w: number; h: number },
  symmetric = false,
): CropBox {
  if (handle === "move") return {
    ...start,
    x: clamp(start.x + dx, -100, 200 - start.w),
    y: clamp(start.y + dy, -100, 200 - start.h),
  };
  let left = start.x;
  let right = start.x + start.w;
  let top = start.y;
  let bottom = start.y + start.h;
  const horizontal = handle.includes("w") ? "west" : handle.includes("e") ? "east" : null;
  const vertical = handle.includes("n") ? "north" : handle.includes("s") ? "south" : null;
  if (horizontal && symmetric) {
    const center = (left + right) / 2;
    const desiredHalf = horizontal === "west" ? center - (left + dx) : right + dx - center;
    const half = clamp(desiredHalf, minimum.w / 2, Math.min(center + 100, 200 - center));
    left = center - half;
    right = center + half;
  } else if (horizontal === "west") left = clamp(left + dx, -100, right - minimum.w);
  else if (horizontal === "east") right = clamp(right + dx, left + minimum.w, 200);
  if (vertical && symmetric) {
    const center = (top + bottom) / 2;
    const desiredHalf = vertical === "north" ? center - (top + dy) : bottom + dy - center;
    const half = clamp(desiredHalf, minimum.h / 2, Math.min(center + 100, 200 - center));
    top = center - half;
    bottom = center + half;
  } else if (vertical === "north") top = clamp(top + dy, -100, bottom - minimum.h);
  else if (vertical === "south") bottom = clamp(bottom + dy, top + minimum.h, 200);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function cropBoxWithPadding(
  naturalSize: { w: number; h: number },
  padding: { top: number; right: number; bottom: number; left: number },
): CropBox {
  const top = Math.max(0, padding.top);
  const right = Math.max(0, padding.right);
  const bottom = Math.max(0, padding.bottom);
  const left = Math.max(0, padding.left);
  return {
    x: -(left / naturalSize.w) * 100,
    y: -(top / naturalSize.h) * 100,
    w: ((naturalSize.w + left + right) / naturalSize.w) * 100,
    h: ((naturalSize.h + top + bottom) / naturalSize.h) * 100,
  };
}

export function cropBoxFromDrag(
  start: { x: number; y: number },
  point: { x: number; y: number },
  symmetric = false,
): CropBox {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  if (symmetric) return { x: start.x - Math.abs(dx), y: start.y - Math.abs(dy), w: Math.max(1, Math.abs(dx) * 2), h: Math.max(1, Math.abs(dy) * 2) };
  return { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), w: Math.max(1, Math.abs(dx)), h: Math.max(1, Math.abs(dy)) };
}
