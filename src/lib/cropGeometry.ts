export interface CropBox { x: number; y: number; w: number; h: number; }

export function cropPixels(box: CropBox, naturalSize: { w: number; h: number }) {
  return {
    x: Math.round((box.x / 100) * naturalSize.w),
    y: Math.round((box.y / 100) * naturalSize.h),
    width: Math.round((box.w / 100) * naturalSize.w),
    height: Math.round((box.h / 100) * naturalSize.h),
  };
}
