/** Pure model and canvas helpers for non-destructive image annotations. */

export type AnnotationKind = "frame" | "ellipse" | "mask" | "label";
export type MaskStyle = "solid" | "blur" | "mosaic";

export interface ImageBounds {
  width: number;
  height: number;
}

export interface AnnotationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameAnnotation extends AnnotationRect {
  id: string;
  type: "frame";
  color: string;
  lineWidth: number;
}

export interface EllipseAnnotation extends AnnotationRect {
  id: string;
  type: "ellipse";
  color: string;
  lineWidth: number;
}

export interface MaskAnnotation extends AnnotationRect {
  id: string;
  type: "mask";
  style: MaskStyle;
  /** Used by solid masks. Kept for all masks so a style can be switched safely. */
  color: string;
}

export interface LabelAnnotation extends AnnotationRect {
  id: string;
  type: "label";
  text: string;
  textColor: string;
  backgroundColor: string;
  fontSize: number;
}

export type ImageAnnotation = FrameAnnotation | EllipseAnnotation | MaskAnnotation | LabelAnnotation;

export interface ImageAnnotationState {
  annotations: ImageAnnotation[];
  selectedId: string | null;
  /** Snapshots contain annotations only: changing selection is deliberately not undoable. */
  undoStack: ImageAnnotation[][];
  redoStack: ImageAnnotation[][];
}

export interface AnnotationChanges extends Partial<AnnotationRect> {
  color?: string;
  lineWidth?: number;
  style?: MaskStyle;
  text?: string;
  textColor?: string;
  backgroundColor?: string;
  fontSize?: number;
}

export type ImageAnnotationAction =
  | { type: "place"; annotation: ImageAnnotation; bounds?: ImageBounds }
  | { type: "select"; id: string | null }
  | { type: "update"; id?: string; changes: AnnotationChanges; bounds?: ImageBounds }
  | { type: "scaleSelected"; scale: number; bounds?: ImageBounds }
  | { type: "delete"; id?: string }
  | { type: "commitSelection" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset" };

const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;

/** Clamp a value inclusively. Invalid values resolve to the lower bound. */
export function clamp(value: number, minimum: number, maximum: number): number {
  const lower = Math.min(minimum, maximum);
  const upper = Math.max(minimum, maximum);
  return Math.min(upper, Math.max(lower, finite(value, lower)));
}

/**
 * Returns a non-negative rectangle wholly inside the image bounds. Negative
 * widths/heights are accepted so drag gestures can be passed in directly.
 */
export function clampRect(rect: AnnotationRect, bounds: ImageBounds): AnnotationRect {
  const imageWidth = Math.max(0, finite(bounds.width));
  const imageHeight = Math.max(0, finite(bounds.height));
  const x1 = clamp(finite(rect.x), 0, imageWidth);
  const y1 = clamp(finite(rect.y), 0, imageHeight);
  const x2 = clamp(finite(rect.x) + finite(rect.width), 0, imageWidth);
  const y2 = clamp(finite(rect.y) + finite(rect.height), 0, imageHeight);

  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/** Clamp geometry and type-specific numeric fields while retaining annotation data. */
export function clampAnnotation(annotation: ImageAnnotation, bounds: ImageBounds): ImageAnnotation {
  const rect = clampRect(annotation, bounds);
  if (annotation.type === "frame" || annotation.type === "ellipse") {
    return { ...annotation, ...rect, lineWidth: Math.max(1, finite(annotation.lineWidth, 1)) };
  }
  if (annotation.type === "label") {
    return { ...annotation, ...rect, fontSize: Math.max(1, finite(annotation.fontSize, 1)) };
  }
  return { ...annotation, ...rect };
}

export function createImageAnnotationState(
  annotations: ImageAnnotation[] = [],
): ImageAnnotationState {
  return { annotations: [...annotations], selectedId: null, undoStack: [], redoStack: [] };
}

function snapshot(annotations: ImageAnnotation[]): ImageAnnotation[] {
  return annotations.map((annotation) => ({ ...annotation }));
}

function withHistory(state: ImageAnnotationState, annotations: ImageAnnotation[], selectedId = state.selectedId): ImageAnnotationState {
  return {
    annotations,
    selectedId,
    undoStack: [...state.undoStack, snapshot(state.annotations)],
    redoStack: [],
  };
}

function selectedAnnotation(state: ImageAnnotationState, requestedId?: string): ImageAnnotation | undefined {
  const id = requestedId ?? state.selectedId;
  return id === null || id === undefined ? undefined : state.annotations.find((item) => item.id === id);
}

function updateAnnotation(annotation: ImageAnnotation, changes: AnnotationChanges): ImageAnnotation {
  // id and type intentionally cannot be changed through an update action.
  return { ...annotation, ...changes, id: annotation.id, type: annotation.type } as ImageAnnotation;
}

/** Reducer whose edit operations, but not selection operations, are undoable. */
export function imageAnnotationReducer(
  state: ImageAnnotationState,
  action: ImageAnnotationAction,
): ImageAnnotationState {
  switch (action.type) {
    case "reset":
      return createImageAnnotationState();
    case "place": {
      const annotation = action.bounds ? clampAnnotation(action.annotation, action.bounds) : action.annotation;
      const annotations = [...state.annotations.filter((item) => item.id !== annotation.id), annotation];
      return withHistory(state, annotations, annotation.id);
    }
    case "select":
      return state.annotations.some((item) => item.id === action.id)
        ? { ...state, selectedId: action.id }
        : { ...state, selectedId: null };
    case "commitSelection":
      return state.selectedId === null ? state : { ...state, selectedId: null };
    case "update": {
      const target = selectedAnnotation(state, action.id);
      if (!target) return state;
      const replacement = action.bounds
        ? clampAnnotation(updateAnnotation(target, action.changes), action.bounds)
        : updateAnnotation(target, action.changes);
      return withHistory(
        state,
        state.annotations.map((item) => item.id === target.id ? replacement : item),
      );
    }
    case "scaleSelected": {
      const target = selectedAnnotation(state);
      if (!target || !Number.isFinite(action.scale) || action.scale <= 0) return state;
      const width = target.width * action.scale;
      const height = target.height * action.scale;
      const scaled = updateAnnotation(target, {
        x: target.x + (target.width - width) / 2,
        y: target.y + (target.height - height) / 2,
        width,
        height,
      });
      const replacement = action.bounds ? clampAnnotation(scaled, action.bounds) : scaled;
      return withHistory(
        state,
        state.annotations.map((item) => item.id === target.id ? replacement : item),
      );
    }
    case "delete": {
      const target = selectedAnnotation(state, action.id);
      if (!target) return state;
      return withHistory(
        state,
        state.annotations.filter((item) => item.id !== target.id),
        state.selectedId === target.id ? null : state.selectedId,
      );
    }
    case "undo": {
      const previous = state.undoStack[state.undoStack.length - 1];
      if (!previous) return state;
      const annotations = snapshot(previous);
      return {
        annotations,
        selectedId: annotations.some((item) => item.id === state.selectedId) ? state.selectedId : null,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, snapshot(state.annotations)],
      };
    }
    case "redo": {
      const next = state.redoStack[state.redoStack.length - 1];
      if (!next) return state;
      const annotations = snapshot(next);
      return {
        annotations,
        selectedId: annotations.some((item) => item.id === state.selectedId) ? state.selectedId : null,
        undoStack: [...state.undoStack, snapshot(state.annotations)],
        redoStack: state.redoStack.slice(0, -1),
      };
    }
  }
}

export function containsPoint(annotation: AnnotationRect, x: number, y: number): boolean {
  return x >= annotation.x && x <= annotation.x + annotation.width
    && y >= annotation.y && y <= annotation.y + annotation.height;
}

export function containsAnnotationPoint(annotation: ImageAnnotation, x: number, y: number): boolean {
  if (annotation.type !== "ellipse") return containsPoint(annotation, x, y);
  if (annotation.width <= 0 || annotation.height <= 0) return false;
  const normalizedX = (x - (annotation.x + annotation.width / 2)) / (annotation.width / 2);
  const normalizedY = (y - (annotation.y + annotation.height / 2)) / (annotation.height / 2);
  return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
}

/** Returns the top-most annotation at the given original-image pixel. */
export function hitTestAnnotation(
  annotations: readonly ImageAnnotation[],
  x: number,
  y: number,
): ImageAnnotation | undefined {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    if (containsAnnotationPoint(annotations[index], x, y)) return annotations[index];
  }
  return undefined;
}

function canvasRect(annotation: AnnotationRect, bounds: ImageBounds): AnnotationRect {
  return clampRect(annotation, bounds);
}

function applyBlur(ctx: CanvasRenderingContext2D, rect: AnnotationRect): void {
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  if (width < 1 || height < 1) return;
  const source = ctx.getImageData(Math.floor(rect.x), Math.floor(rect.y), width, height);
  const output = new Uint8ClampedArray(source.data);
  const radius = Math.max(1, Math.min(8, Math.round(Math.min(width, height) / 24)));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sums = [0, 0, 0, 0];
      let samples = 0;
      for (let sampleY = Math.max(0, y - radius); sampleY <= Math.min(height - 1, y + radius); sampleY += 1) {
        for (let sampleX = Math.max(0, x - radius); sampleX <= Math.min(width - 1, x + radius); sampleX += 1) {
          const offset = (sampleY * width + sampleX) * 4;
          sums[0] += source.data[offset];
          sums[1] += source.data[offset + 1];
          sums[2] += source.data[offset + 2];
          sums[3] += source.data[offset + 3];
          samples += 1;
        }
      }
      const offset = (y * width + x) * 4;
      output[offset] = sums[0] / samples;
      output[offset + 1] = sums[1] / samples;
      output[offset + 2] = sums[2] / samples;
      output[offset + 3] = sums[3] / samples;
    }
  }
  source.data.set(output);
  ctx.putImageData(source, Math.floor(rect.x), Math.floor(rect.y));
}

function applyMosaic(ctx: CanvasRenderingContext2D, rect: AnnotationRect): void {
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  if (width < 1 || height < 1) return;
  const source = ctx.getImageData(Math.floor(rect.x), Math.floor(rect.y), width, height);
  const blockSize = Math.max(4, Math.min(24, Math.round(Math.min(width, height) / 12)));
  for (let blockY = 0; blockY < height; blockY += blockSize) {
    for (let blockX = 0; blockX < width; blockX += blockSize) {
      const endX = Math.min(width, blockX + blockSize);
      const endY = Math.min(height, blockY + blockSize);
      const sums = [0, 0, 0, 0];
      let samples = 0;
      for (let y = blockY; y < endY; y += 1) {
        for (let x = blockX; x < endX; x += 1) {
          const offset = (y * width + x) * 4;
          sums[0] += source.data[offset]; sums[1] += source.data[offset + 1];
          sums[2] += source.data[offset + 2]; sums[3] += source.data[offset + 3];
          samples += 1;
        }
      }
      for (let y = blockY; y < endY; y += 1) {
        for (let x = blockX; x < endX; x += 1) {
          const offset = (y * width + x) * 4;
          source.data[offset] = sums[0] / samples;
          source.data[offset + 1] = sums[1] / samples;
          source.data[offset + 2] = sums[2] / samples;
          source.data[offset + 3] = sums[3] / samples;
        }
      }
    }
  }
  ctx.putImageData(source, Math.floor(rect.x), Math.floor(rect.y));
}

/**
 * Paint annotations onto an already-rendered image canvas. Masks read and alter
 * only their own image pixels; frames and labels are then drawn above them.
 */
export function drawImageAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: readonly ImageAnnotation[],
): void {
  const bounds = { width: ctx.canvas.width, height: ctx.canvas.height };
  for (const annotation of annotations) {
    const rect = canvasRect(annotation, bounds);
    if (annotation.type !== "mask") continue;
    if (annotation.style === "solid") {
      ctx.save();
      ctx.fillStyle = annotation.color;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.restore();
    } else if (annotation.style === "blur") {
      applyBlur(ctx, rect);
    } else {
      applyMosaic(ctx, rect);
    }
  }

  for (const annotation of annotations) {
    const rect = canvasRect(annotation, bounds);
    if (annotation.type === "frame") {
      ctx.save();
      ctx.strokeStyle = annotation.color;
      ctx.lineWidth = annotation.lineWidth;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      ctx.restore();
    } else if (annotation.type === "ellipse") {
      ctx.save();
      ctx.strokeStyle = annotation.color;
      ctx.lineWidth = annotation.lineWidth;
      ctx.beginPath();
      ctx.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (annotation.type === "label") {
      ctx.save();
      ctx.fillStyle = annotation.backgroundColor;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.fillStyle = annotation.textColor;
      ctx.font = `${annotation.fontSize}px sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(annotation.text, rect.x + Math.min(6, rect.width / 2), rect.y + rect.height / 2, Math.max(0, rect.width - 12));
      ctx.restore();
    }
  }
}

/** Create a pasted copy without sharing identity with the source annotation. */
export function duplicateImageAnnotation(
  annotation: ImageAnnotation,
  id: string,
  offset = 16,
  bounds?: ImageBounds,
): ImageAnnotation {
  const duplicate = {
    ...annotation,
    id,
    x: annotation.x + offset,
    y: annotation.y + offset,
  } as ImageAnnotation;
  return bounds ? clampAnnotation(duplicate, bounds) : duplicate;
}
