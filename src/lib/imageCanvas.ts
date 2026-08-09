export type CanvasEdge = "north" | "east" | "south" | "west";

export interface ImageCanvasGeometry {
  width: number;
  height: number;
  imageX: number;
  imageY: number;
}

export interface ImageCanvasResize {
  geometry: ImageCanvasGeometry;
  annotationShiftX: number;
  annotationShiftY: number;
}

const dimension = (value: number) => Math.max(1, Math.round(Number.isFinite(value) ? value : 1));

export function resizeImageCanvasCentered(
  current: ImageCanvasGeometry,
  width: number,
  height: number,
): ImageCanvasResize {
  const nextWidth = dimension(width);
  const nextHeight = dimension(height);
  const annotationShiftX = (nextWidth - current.width) / 2;
  const annotationShiftY = (nextHeight - current.height) / 2;
  return {
    geometry: {
      width: nextWidth,
      height: nextHeight,
      imageX: current.imageX + annotationShiftX,
      imageY: current.imageY + annotationShiftY,
    },
    annotationShiftX,
    annotationShiftY,
  };
}

export function resizeImageCanvasFromEdge(
  current: ImageCanvasGeometry,
  edge: CanvasEdge,
  deltaX: number,
  deltaY: number,
): ImageCanvasResize {
  let width = current.width;
  let height = current.height;
  if (edge === "east") width = dimension(current.width + deltaX);
  if (edge === "west") width = dimension(current.width - deltaX);
  if (edge === "south") height = dimension(current.height + deltaY);
  if (edge === "north") height = dimension(current.height - deltaY);
  const annotationShiftX = edge === "west" ? width - current.width : 0;
  const annotationShiftY = edge === "north" ? height - current.height : 0;
  return {
    geometry: {
      width,
      height,
      imageX: current.imageX + annotationShiftX,
      imageY: current.imageY + annotationShiftY,
    },
    annotationShiftX,
    annotationShiftY,
  };
}
