/** Pure model and canvas helpers for non-destructive image annotations. */

export type AnnotationKind = "frame" | "ellipse" | "arrow" | "mask" | "label";
export type MaskStyle = "solid" | "blur" | "mosaic";
export type ArrowDirection = "right" | "down-right" | "down" | "down-left" | "left" | "up-left" | "up" | "up-right";

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

export interface ArrowAnnotation extends AnnotationRect {
  id: string;
  type: "arrow";
  color: string;
  lineWidth: number;
  direction: ArrowDirection;
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

export interface LineAnnotation extends AnnotationRect {
  id: string;
  type: "line";
  color: string;
  lineWidth: number;
  reverse: boolean;
}

export interface StrokePoint { x: number; y: number }

export interface StrokeAnnotation extends AnnotationRect {
  id: string;
  type: "stroke";
  mode: "pencil" | "brush" | "eraser";
  color: string;
  lineWidth: number;
  points: StrokePoint[];
}

export interface FillAnnotation extends AnnotationRect {
  id: string;
  type: "fill";
  color: string;
  tolerance: number;
}

export type ImageAnnotation = FrameAnnotation | EllipseAnnotation | ArrowAnnotation | MaskAnnotation | LabelAnnotation | LineAnnotation | StrokeAnnotation | FillAnnotation;

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
  direction?: ArrowDirection;
}

export type ImageAnnotationAction =
  | { type: "place"; annotation: ImageAnnotation; bounds?: ImageBounds }
  | { type: "select"; id: string | null }
  | { type: "update"; id?: string; changes: AnnotationChanges; bounds?: ImageBounds }
  | { type: "scaleSelected"; scale: number; bounds?: ImageBounds }
  | { type: "resizeSelected"; axis: "width" | "height"; delta: number; bounds?: ImageBounds }
  | { type: "translateAll"; x: number; y: number }
  | { type: "delete"; id?: string }
  | { type: "commitSelection" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "restore"; annotations: ImageAnnotation[] }
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
  if (annotation.type === "frame" || annotation.type === "ellipse" || annotation.type === "arrow" || annotation.type === "line" || annotation.type === "stroke") {
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
  return annotations.map((annotation) => annotation.type === "stroke"
    ? { ...annotation, points: annotation.points.map((point) => ({ ...point })) }
    : { ...annotation });
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
  if (annotation.type === "stroke" && (changes.x !== undefined || changes.y !== undefined)) {
    const x = changes.x ?? annotation.x;
    const y = changes.y ?? annotation.y;
    const deltaX = x - annotation.x;
    const deltaY = y - annotation.y;
    return {
      ...annotation,
      ...changes,
      id: annotation.id,
      type: annotation.type,
      points: annotation.points.map((point) => ({ x: point.x + deltaX, y: point.y + deltaY })),
    } as ImageAnnotation;
  }
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
    case "restore":
      return createImageAnnotationState(snapshot(action.annotations));
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
    case "resizeSelected": {
      const target = selectedAnnotation(state);
      if (!target || !Number.isFinite(action.delta) || action.delta === 0) return state;
      const centerX = target.x + target.width / 2;
      const centerY = target.y + target.height / 2;
      const maximumWidth = action.bounds
        ? Math.max(1, Math.min(centerX, action.bounds.width - centerX) * 2)
        : Number.POSITIVE_INFINITY;
      const maximumHeight = action.bounds
        ? Math.max(1, Math.min(centerY, action.bounds.height - centerY) * 2)
        : Number.POSITIVE_INFINITY;
      const width = action.axis === "width"
        ? clamp(target.width + action.delta, 1, maximumWidth)
        : target.width;
      const height = action.axis === "height"
        ? clamp(target.height + action.delta, 1, maximumHeight)
        : target.height;
      const replacement = updateAnnotation(target, {
        x: centerX - width / 2,
        y: centerY - height / 2,
        width,
        height,
      });
      return withHistory(
        state,
        state.annotations.map((item) => item.id === target.id ? replacement : item),
      );
    }
    case "translateAll": {
      if ((!Number.isFinite(action.x) || action.x === 0) && (!Number.isFinite(action.y) || action.y === 0)) return state;
      const x = finite(action.x);
      const y = finite(action.y);
      const translate = (items: ImageAnnotation[]) => items.map((item) => item.type === "stroke"
        ? { ...item, x: item.x + x, y: item.y + y, points: item.points.map((point) => ({ x: point.x + x, y: point.y + y })) }
        : { ...item, x: item.x + x, y: item.y + y }) as ImageAnnotation[];
      return {
        ...state,
        annotations: translate(state.annotations),
        undoStack: state.undoStack.map(translate),
        redoStack: state.redoStack.map(translate),
      };
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
  if (annotation.type === "fill") return Math.hypot(x - annotation.x, y - annotation.y) <= 8;
  if (annotation.type === "stroke") {
    return annotation.points.some((point, index) => {
      const previous = annotation.points[index - 1] ?? point;
      const dx = point.x - previous.x;
      const dy = point.y - previous.y;
      const lengthSquared = dx * dx + dy * dy;
      const ratio = lengthSquared === 0 ? 0 : clamp(((x - previous.x) * dx + (y - previous.y) * dy) / lengthSquared, 0, 1);
      return Math.hypot(x - (previous.x + dx * ratio), y - (previous.y + dy * ratio)) <= annotation.lineWidth + 4;
    });
  }
  if (annotation.type === "ellipse") {
    if (annotation.width <= 0 || annotation.height <= 0) return false;
    const normalizedX = (x - (annotation.x + annotation.width / 2)) / (annotation.width / 2);
    const normalizedY = (y - (annotation.y + annotation.height / 2)) / (annotation.height / 2);
    return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
  }
  if (annotation.type === "arrow" || annotation.type === "line") {
    const [start, end] = annotation.type === "line"
      ? annotation.reverse
        ? [{ x: annotation.x + annotation.width, y: annotation.y }, { x: annotation.x, y: annotation.y + annotation.height }]
        : [{ x: annotation.x, y: annotation.y }, { x: annotation.x + annotation.width, y: annotation.y + annotation.height }]
      : arrowEndpoints(annotation, annotation.direction);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(x - start.x, y - start.y) <= annotation.lineWidth + 6;
    const ratio = clamp(((x - start.x) * dx + (y - start.y) * dy) / lengthSquared, 0, 1);
    const distance = Math.hypot(x - (start.x + dx * ratio), y - (start.y + dy * ratio));
    return distance <= Math.max(6, annotation.lineWidth + 4);
  }
  return containsPoint(annotation, x, y);
}

function arrowEndpoints(rect: AnnotationRect, direction: ArrowDirection): [{ x: number; y: number }, { x: number; y: number }] {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  switch (direction) {
    case "right": return [{ x: left, y: centerY }, { x: right, y: centerY }];
    case "down-right": return [{ x: left, y: top }, { x: right, y: bottom }];
    case "down": return [{ x: centerX, y: top }, { x: centerX, y: bottom }];
    case "down-left": return [{ x: right, y: top }, { x: left, y: bottom }];
    case "left": return [{ x: right, y: centerY }, { x: left, y: centerY }];
    case "up-left": return [{ x: right, y: bottom }, { x: left, y: top }];
    case "up": return [{ x: centerX, y: bottom }, { x: centerX, y: top }];
    case "up-right": return [{ x: left, y: bottom }, { x: right, y: top }];
  }
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

function isHtmlCanvasContext(ctx: CanvasRenderingContext2D): boolean {
  return typeof document !== "undefined"
    && typeof HTMLCanvasElement !== "undefined"
    && ctx.canvas instanceof HTMLCanvasElement;
}

function applyNativeBlur(ctx: CanvasRenderingContext2D, rect: AnnotationRect): void {
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  if (width < 1 || height < 1) return;
  try {
    const scratch = document.createElement("canvas");
    scratch.width = width;
    scratch.height = height;
    const scratchContext = scratch.getContext("2d");
    if (!scratchContext) throw new Error("blur scratch canvas unavailable");
    scratchContext.drawImage(ctx.canvas, Math.floor(rect.x), Math.floor(rect.y), width, height, 0, 0, width, height);
    const radius = Math.max(2, Math.min(16, Math.round(Math.min(width, height) / 18)));
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(scratch, rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
  } catch {
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = "#808080";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
  }
}

function applyPixelBlur(ctx: CanvasRenderingContext2D, rect: AnnotationRect): void {
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

function applyNativeMosaic(ctx: CanvasRenderingContext2D, rect: AnnotationRect): void {
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  if (width < 1 || height < 1) return;
  try {
    const blockSize = Math.max(4, Math.min(24, Math.round(Math.min(width, height) / 12)));
    const scratch = document.createElement("canvas");
    scratch.width = Math.max(1, Math.ceil(width / blockSize));
    scratch.height = Math.max(1, Math.ceil(height / blockSize));
    const scratchContext = scratch.getContext("2d");
    if (!scratchContext) throw new Error("mosaic scratch canvas unavailable");
    scratchContext.imageSmoothingEnabled = true;
    scratchContext.drawImage(ctx.canvas, Math.floor(rect.x), Math.floor(rect.y), width, height, 0, 0, scratch.width, scratch.height);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch, 0, 0, scratch.width, scratch.height, rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
  } catch {
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = "#808080";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
  }
}

function applyPixelMosaic(ctx: CanvasRenderingContext2D, rect: AnnotationRect): void {
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

function floodFill(ctx: CanvasRenderingContext2D, annotation: FillAnnotation): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const startX = Math.floor(annotation.x);
  const startY = Math.floor(annotation.y);
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const startOffset = (startY * width + startX) * 4;
  const target = [data[startOffset], data[startOffset + 1], data[startOffset + 2], data[startOffset + 3]];
  const color = /^#([0-9a-f]{6})$/i.exec(annotation.color);
  if (!color) return;
  const packed = Number.parseInt(color[1], 16);
  const replacement = [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255, 255];
  if (target.every((value, index) => value === replacement[index])) return;
  const visited = new Uint8Array(width * height);
  const startPixel = startY * width + startX;
  const queue = [startPixel];
  visited[startPixel] = 1;
  const tolerance = Math.max(0, annotation.tolerance);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pixel = queue[cursor];
    const offset = pixel * 4;
    if (Math.max(
      Math.abs(data[offset] - target[0]),
      Math.abs(data[offset + 1] - target[1]),
      Math.abs(data[offset + 2] - target[2]),
      Math.abs(data[offset + 3] - target[3]),
    ) > tolerance) continue;
    data[offset] = replacement[0]; data[offset + 1] = replacement[1];
    data[offset + 2] = replacement[2]; data[offset + 3] = replacement[3];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const enqueue = (candidate: number) => {
      if (visited[candidate]) return;
      visited[candidate] = 1;
      queue.push(candidate);
    };
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - width);
    if (y + 1 < height) enqueue(pixel + width);
  }
  ctx.putImageData(image, 0, 0);
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
    if (annotation.type === "fill") {
      floodFill(ctx, annotation);
    } else if (annotation.type === "stroke" && annotation.mode === "eraser") {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = annotation.lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      annotation.points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
      ctx.stroke();
      ctx.restore();
    } else if (annotation.type !== "mask") continue;
    else if (annotation.style === "solid") {
      ctx.save();
      ctx.fillStyle = annotation.color;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.restore();
    } else if (annotation.style === "blur") {
      if (isHtmlCanvasContext(ctx)) applyNativeBlur(ctx, rect);
      else applyPixelBlur(ctx, rect);
    } else {
      if (isHtmlCanvasContext(ctx)) applyNativeMosaic(ctx, rect);
      else applyPixelMosaic(ctx, rect);
    }
  }

  for (const annotation of annotations) {
    const rect = canvasRect(annotation, bounds);
    if (annotation.type === "stroke" && annotation.mode !== "eraser") {
      ctx.save();
      ctx.strokeStyle = annotation.color;
      ctx.globalAlpha = annotation.mode === "pencil" ? 0.82 : 1;
      ctx.lineWidth = annotation.lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      annotation.points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
      ctx.stroke();
      ctx.restore();
    } else if (annotation.type === "line") {
      ctx.save();
      ctx.strokeStyle = annotation.color;
      ctx.lineWidth = annotation.lineWidth;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(annotation.reverse ? annotation.x + annotation.width : annotation.x, annotation.y);
      ctx.lineTo(annotation.reverse ? annotation.x : annotation.x + annotation.width, annotation.y + annotation.height);
      ctx.stroke();
      ctx.restore();
    } else if (annotation.type === "frame") {
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
    } else if (annotation.type === "arrow") {
      const [start, end] = arrowEndpoints(rect, annotation.direction);
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const headLength = Math.max(10, Math.min(32, Math.hypot(end.x - start.x, end.y - start.y) * 0.24));
      const headAngle = Math.PI / 7;
      ctx.save();
      ctx.strokeStyle = annotation.color;
      ctx.lineWidth = annotation.lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - headLength * Math.cos(angle - headAngle), end.y - headLength * Math.sin(angle - headAngle));
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - headLength * Math.cos(angle + headAngle), end.y - headLength * Math.sin(angle + headAngle));
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
