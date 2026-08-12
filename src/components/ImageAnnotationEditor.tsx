import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { CropTarget } from "../hooks/useCropEditor";
import { saveRenderedImage } from "../lib/commands";
import {
  resizeImageCanvasCentered,
  resizeImageCanvasFromEdge,
  type CanvasEdge,
  type ImageCanvasGeometry,
  type ImageCanvasResize,
} from "../lib/imageCanvas";
import {
  clamp,
  createImageAnnotationState,
  drawImageAnnotations,
  duplicateImageAnnotation,
  hitTestAnnotation,
  imageAnnotationReducer,
  type AnnotationKind,
  type ArrowDirection,
  type ImageAnnotation,
  type MaskStyle,
} from "../lib/imageAnnotations";
import "../styles/image-annotation.css";

type Tool = "select" | AnnotationKind;

interface ContextMenuState {
  clientX: number;
  clientY: number;
  imageX: number;
  imageY: number;
  targetId: string | null;
}

interface DragState {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  annotationX: number;
  annotationY: number;
}

interface CanvasResizeDragState {
  edge: CanvasEdge;
  pointerId: number;
  startX: number;
  startY: number;
  startGeometry: ImageCanvasGeometry;
}

const RECOMMENDED_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6"];
const IMAGE_PATH_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp)$/i;
const DEFAULT_STAMP_SIZES: Record<AnnotationKind, { width: number; height: number }> = {
  frame: { width: 320, height: 180 },
  ellipse: { width: 240, height: 160 },
  arrow: { width: 240, height: 80 },
  mask: { width: 320, height: 120 },
  label: { width: 200, height: 48 },
};

const newAnnotationId = () => `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function ImageAnnotationEditor({
  target,
  imageVersion,
  onApply,
  onCancel,
  onError,
}: {
  target: CropTarget;
  imageVersion: number;
  onApply: (filename: string, backupAvailable: boolean) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const acceptedVersionRef = useRef(imageVersion);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const replacementFileInputRef = useRef<HTMLInputElement>(null);
  const replacementObjectUrlRef = useRef<string | null>(null);
  const displayedImageSizeRef = useRef<{ width: number; height: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const canvasResizeDragRef = useRef<CanvasResizeDragState | null>(null);
  const canvasResizePreviewRef = useRef<ImageCanvasResize | null>(null);
  const originalSourceSizeRef = useRef<{ width: number; height: number } | null>(null);
  const [state, dispatch] = useReducer(imageAnnotationReducer, undefined, () => createImageAnnotationState());
  const [tool, setTool] = useState<Tool>("frame");
  const [stampSizes, setStampSizes] = useState(DEFAULT_STAMP_SIZES);
  const [lineWidth, setLineWidth] = useState(6);
  const [color, setColor] = useState("#ef4444");
  const [maskStyle, setMaskStyle] = useState<MaskStyle>("blur");
  const [arrowDirection, setArrowDirection] = useState<ArrowDirection>("right");
  const [labelText, setLabelText] = useState("ラベル");
  const [textColor, setTextColor] = useState("#ffffff");
  const [backgroundColor, setBackgroundColor] = useState("#dc2626");
  const [fontSize, setFontSize] = useState(32);
  const [canvasGeometry, setCanvasGeometry] = useState<ImageCanvasGeometry>({ width: 0, height: 0, imageX: 0, imageY: 0 });
  const [canvasResizePreview, setCanvasResizePreview] = useState<ImageCanvasResize | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [clipboard, setClipboard] = useState<ImageAnnotation | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [loadedVersion, setLoadedVersion] = useState(imageVersion);
  const [saving, setSaving] = useState(false);
  const [externalConflict, setExternalConflict] = useState(false);
  const [replacementPath, setReplacementPath] = useState("");
  const [replacementSource, setReplacementSource] = useState<string | null>(null);
  const [replacementLabel, setReplacementLabel] = useState<string | null>(null);
  const lastRenderError = useRef<string | null>(null);
  const selected = useMemo(
    () => state.annotations.find((annotation) => annotation.id === state.selectedId),
    [state.annotations, state.selectedId],
  );
  const activeKind = selected?.type ?? (tool === "select" ? null : tool);
  const sourceSize = originalSourceSizeRef.current;
  const canvasDirty = sourceSize !== null && (
    canvasGeometry.width !== sourceSize.width
    || canvasGeometry.height !== sourceSize.height
    || canvasGeometry.imageX !== 0
    || canvasGeometry.imageY !== 0
  );
  const dirty = state.undoStack.length > 0 || canvasDirty || replacementSource !== null;
  const hasOutputChanges = state.annotations.length > 0 || canvasDirty || replacementSource !== null;
  const stampKind: AnnotationKind = tool === "select" ? "frame" : tool;
  const { width, height } = stampSizes[stampKind];
  const updateStampDimension = (dimension: "width" | "height", updater: React.SetStateAction<number>) => {
    setStampSizes((current) => {
      const previous = current[stampKind][dimension];
      const value = typeof updater === "function" ? updater(previous) : updater;
      return { ...current, [stampKind]: { ...current[stampKind], [dimension]: value } };
    });
  };
  const setWidth = (updater: React.SetStateAction<number>) => updateStampDimension("width", updater);
  const setHeight = (updater: React.SetStateAction<number>) => updateStampDimension("height", updater);

  const releaseReplacementObjectUrl = () => {
    if (replacementObjectUrlRef.current) URL.revokeObjectURL(replacementObjectUrlRef.current);
    replacementObjectUrlRef.current = null;
  };
  const beginReplacement = (source: string, label: string, objectUrl: string | null = null) => {
    if (!originalSourceSizeRef.current) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      onError("元画像の読み込みが完了してから差し替えてください。");
      return;
    }
    releaseReplacementObjectUrl();
    replacementObjectUrlRef.current = objectUrl;
    setReplacementSource(source);
    setReplacementLabel(label);
  };
  const replaceFromPath = (value: string) => {
    const path = value.trim().replace(/^['\"]|['\"]$/g, "");
    if (!IMAGE_PATH_PATTERN.test(path)) {
      onError("差し替え可能な画像パスを指定してください。");
      return;
    }
    let source = path;
    try {
      source = convertFileSrc(path);
    } catch {
      // Browser tests and previews can load ordinary URLs without Tauri conversion.
    }
    setReplacementPath(path);
    beginReplacement(source, path);
  };
  const replaceFromFile = (file: File) => {
    if (!file.type.startsWith("image/") && !IMAGE_PATH_PATTERN.test(file.name)) {
      onError("画像ファイルを貼り付けるかドロップしてください。");
      return;
    }
    try {
      const objectUrl = URL.createObjectURL(file);
      beginReplacement(objectUrl, file.name || "貼り付け画像", objectUrl);
    } catch (error) {
      onError(`差し替え画像を読み込めませんでした: ${String(error)}`);
    }
  };

  const displayGeometry = canvasResizePreview?.geometry ?? canvasGeometry;
  const imageBounds = () => ({
    width: displayGeometry.width || canvasRef.current?.width || 0,
    height: displayGeometry.height || canvasRef.current?.height || 0,
  });

  const makeAnnotation = (x: number, y: number): ImageAnnotation => {
    const common = {
      id: newAnnotationId(),
      x: x - width / 2,
      y: y - height / 2,
      width,
      height,
    };
    if (tool === "frame" || tool === "ellipse") return { ...common, type: tool, color, lineWidth };
    if (tool === "arrow") return { ...common, type: "arrow", color, lineWidth, direction: arrowDirection };
    if (tool === "mask") return { ...common, type: "mask", style: maskStyle, color };
    return { ...common, type: "label", text: labelText, textColor, backgroundColor, fontSize };
  };

  const positionedAnnotations = canvasResizePreview
    ? state.annotations.map((annotation) => ({
      ...annotation,
      x: annotation.x + canvasResizePreview.annotationShiftX,
      y: annotation.y + canvasResizePreview.annotationShiftY,
    })) as ImageAnnotation[]
    : state.annotations;
  const effectiveAnnotations = dragPreview
    ? positionedAnnotations.map((annotation) => annotation.id === dragPreview.id
      ? { ...annotation, x: dragPreview.x, y: dragPreview.y }
      : annotation) as ImageAnnotation[]
    : positionedAnnotations;
  const positionedSelected = selected && canvasResizePreview
    ? { ...selected, x: selected.x + canvasResizePreview.annotationShiftX, y: selected.y + canvasResizePreview.annotationShiftY }
    : selected;
  const effectiveSelected = dragPreview && positionedSelected?.id === dragPreview.id
    ? { ...positionedSelected, x: dragPreview.x, y: dragPreview.y }
    : positionedSelected;

  const render = () => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !image.complete || image.naturalWidth === 0) return;
    try {
      const width = Math.max(1, displayGeometry.width || image.naturalWidth);
      const height = Math.max(1, displayGeometry.height || image.naturalHeight);
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(image, displayGeometry.imageX, displayGeometry.imageY);
      drawImageAnnotations(context, effectiveAnnotations);
      if (!selected && tool !== "select" && cursor) {
        context.save();
        context.globalAlpha = 0.62;
        drawImageAnnotations(context, [makeAnnotation(cursor.x, cursor.y)]);
        context.restore();
      }
      if (effectiveSelected) {
        context.save();
        context.strokeStyle = "#38bdf8";
        context.lineWidth = Math.max(2, canvas.width / 500);
        context.setLineDash([10, 6]);
        context.strokeRect(effectiveSelected.x, effectiveSelected.y, effectiveSelected.width, effectiveSelected.height);
        context.restore();
      }
      lastRenderError.current = null;
    } catch (error) {
      const message = String(error);
      if (lastRenderError.current !== message) {
        lastRenderError.current = message;
        onError(`画像編集のプレビューに失敗しました: ${message}`);
      }
    }
  };

  useEffect(render, [state.annotations, state.selectedId, loadedVersion, canvasGeometry, canvasResizePreview, cursor, dragPreview, tool, width, height, lineWidth, color, arrowDirection, maskStyle, labelText, textColor, backgroundColor, fontSize]);

  useEffect(() => {
    if (imageVersion === acceptedVersionRef.current) return;
    if (dirty) {
      setExternalConflict(true);
    } else {
      acceptedVersionRef.current = imageVersion;
      setLoadedVersion(imageVersion);
    }
  }, [dirty, imageVersion]);

  useEffect(() => {
    const closeContextMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !contextMenuRef.current?.contains(event.target)) setContextMenu(null);
    };
    window.addEventListener("pointerdown", closeContextMenu);
    return () => window.removeEventListener("pointerdown", closeContextMenu);
  }, []);

  useEffect(() => () => releaseReplacementObjectUrl(), []);

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((candidate) => candidate.type.startsWith("image/") || IMAGE_PATH_PATTERN.test(candidate.name));
      if (file) {
        event.preventDefault();
        replaceFromFile(file);
        return;
      }
      if (event.target === replacementFileInputRef.current) return;
      const editingText = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      const text = event.clipboardData?.getData("text/plain").trim() ?? "";
      if (!editingText && IMAGE_PATH_PATTERN.test(text)) {
        event.preventDefault();
        replaceFromPath(text);
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const path = event.payload.paths.find((candidate) => IMAGE_PATH_PATTERN.test(candidate));
      if (path) replaceFromPath(path);
    }).then((remove) => {
      if (disposed) remove();
      else unlisten = remove;
    }).catch(() => {
      // Browser previews use the HTML drop handler below instead of Tauri paths.
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const editingText = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === "Escape") {
        event.preventDefault();
        if (contextMenu) setContextMenu(null);
        else if (state.selectedId) dispatch({ type: "commitSelection" });
        else onCancel();
      } else if (event.key === "Enter" && !editingText) {
        event.preventDefault();
        dispatch({ type: "commitSelection" });
      } else if (event.key === "Delete" && !editingText) {
        event.preventDefault();
        dispatch({ type: "delete" });
      } else if (event.ctrlKey && event.key.toLowerCase() === "x" && !editingText && selected) {
        event.preventDefault();
        setClipboard({ ...selected });
        dispatch({ type: "delete" });
      } else if (event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
      } else if (event.ctrlKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        dispatch({ type: "redo" });
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [contextMenu, onCancel, selected, state.selectedId]);

  const imagePoint = (event: Pick<React.PointerEvent<HTMLCanvasElement>, "clientX" | "clientY" | "currentTarget">) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width,
      y: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height,
    };
  };

  const beginCanvasInteraction = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    setContextMenu(null);
    const point = imagePoint(event);
    const hit = hitTestAnnotation(state.annotations, point.x, point.y);
    const beginDrag = (annotation: ImageAnnotation) => {
      dragRef.current = {
        id: annotation.id,
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        annotationX: annotation.x,
        annotationY: annotation.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    };
    if (tool === "select") {
      if (hit) {
        dispatch({ type: "select", id: hit.id });
        beginDrag(hit);
      } else {
        dispatch({ type: "commitSelection" });
      }
      return;
    }
    if (selected) {
      if (hit?.id === selected.id) {
        beginDrag(selected);
        return;
      }
      dispatch({ type: "commitSelection" });
      return;
    }
    dispatch({
      type: "place",
      annotation: makeAnnotation(point.x, point.y),
      bounds: imageBounds(),
    });
  };

  const moveCanvasPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = imagePoint(event);
    setCursor(point);
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const annotation = state.annotations.find((item) => item.id === drag.id);
    if (!annotation) return;
    setDragPreview({
      id: drag.id,
      x: clamp(drag.annotationX + point.x - drag.startX, 0, event.currentTarget.width - annotation.width),
      y: clamp(drag.annotationY + point.y - drag.startY, 0, event.currentTarget.height - annotation.height),
    });
  };

  const finishCanvasInteraction = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (dragPreview) {
      dispatch({
        type: "update",
        id: drag.id,
        changes: { x: dragPreview.x, y: dragPreview.y },
        bounds: imageBounds(),
      });
    }
    dragRef.current = null;
    setDragPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const apply = async () => {
    const image = imageRef.current;
    if (!image || saving) return;
    setSaving(true);
    try {
      const output = document.createElement("canvas");
      output.width = Math.max(1, canvasGeometry.width);
      output.height = Math.max(1, canvasGeometry.height);
      const context = output.getContext("2d");
      if (!context) throw new Error("画像キャンバスを作成できません。");
      context.drawImage(image, canvasGeometry.imageX, canvasGeometry.imageY);
      drawImageAnnotations(context, state.annotations);
      const blob = await new Promise<Blob>((resolve, reject) =>
        output.toBlob((value) => value ? resolve(value) : reject(new Error("画像をPNGへ変換できません。")), "image/png"),
      );
      const result = await saveRenderedImage({
        path: target.fullPath,
        pngBytes: [...new Uint8Array(await blob.arrayBuffer())],
        expectedSourceWidth: originalSourceSizeRef.current?.width ?? image.naturalWidth,
        expectedSourceHeight: originalSourceSizeRef.current?.height ?? image.naturalHeight,
      });
      onApply(target.filename, result.backup_available);
    } catch (error) {
      onError(`画像編集の保存に失敗しました: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const updateSelected = (changes: Record<string, string | number>) => {
    if (selected) dispatch({ type: "update", changes, bounds: imageBounds() });
  };

  const updateFontSize = (value: number) => {
    const nextFontSize = Math.max(1, value);
    if (selected?.type === "label") {
      updateSelected({ fontSize: nextFontSize });
    } else {
      setFontSize(nextFontSize);
      setStampSizes((current) => ({
        ...current,
        label: { ...current.label, height: nextFontSize + 16 },
      }));
    }
  };

  const setActiveColor = (nextColor: string) => {
    if (selected?.type === "frame" || selected?.type === "ellipse" || selected?.type === "arrow" || selected?.type === "mask") {
      updateSelected({ color: nextColor });
    } else if (selected?.type === "label") {
      updateSelected({ backgroundColor: nextColor });
    } else if (tool === "label") {
      setBackgroundColor(nextColor);
    } else {
      setColor(nextColor);
    }
  };

  const activeColor = selected?.type === "label"
    ? selected.backgroundColor
    : selected && "color" in selected
      ? selected.color
      : tool === "label" ? backgroundColor : color;

  const copyContextTarget = () => {
    const annotation = state.annotations.find((item) => item.id === contextMenu?.targetId);
    if (annotation) setClipboard({ ...annotation });
    setContextMenu(null);
  };

  const cutContextTarget = () => {
    const annotation = state.annotations.find((item) => item.id === contextMenu?.targetId);
    if (annotation) {
      setClipboard({ ...annotation });
      dispatch({ type: "delete", id: annotation.id });
    }
    setContextMenu(null);
  };

  const pasteContextTarget = () => {
    if (!clipboard || !contextMenu) return;
    const positioned = {
      ...clipboard,
      x: contextMenu.imageX - clipboard.width / 2,
      y: contextMenu.imageY - clipboard.height / 2,
    } as ImageAnnotation;
    dispatch({
      type: "place",
      annotation: duplicateImageAnnotation(positioned, newAnnotationId(), 0, imageBounds()),
      bounds: imageBounds(),
    });
    setContextMenu(null);
  };

  const commitCanvasResize = (resize: ImageCanvasResize) => {
    setCanvasGeometry(resize.geometry);
    if (resize.annotationShiftX !== 0 || resize.annotationShiftY !== 0) {
      dispatch({ type: "translateAll", x: resize.annotationShiftX, y: resize.annotationShiftY });
    }
  };
  const setCanvasDimension = (dimension: "width" | "height", value: number) => {
    const resize = resizeImageCanvasCentered(
      canvasGeometry,
      dimension === "width" ? value : canvasGeometry.width,
      dimension === "height" ? value : canvasGeometry.height,
    );
    commitCanvasResize(resize);
  };
  const beginCanvasResizeDrag = (edge: CanvasEdge, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    canvasResizeDragRef.current = {
      edge,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startGeometry: canvasGeometry,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveCanvasResizeDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = canvasResizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const resize = resizeImageCanvasFromEdge(
      drag.startGeometry,
      drag.edge,
      event.clientX - drag.startX,
      event.clientY - drag.startY,
    );
    canvasResizePreviewRef.current = resize;
    setCanvasResizePreview(resize);
  };
  const finishCanvasResizeDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = canvasResizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const resize = canvasResizePreviewRef.current;
    canvasResizeDragRef.current = null;
    canvasResizePreviewRef.current = null;
    setCanvasResizePreview(null);
    if (resize) commitCanvasResize(resize);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const originalImageSource = `${target.rawSrc}${target.rawSrc.includes("?") ? "&" : "?"}annotationVersion=${loadedVersion}`;
  const imageSource = replacementSource ?? originalImageSource;
  const canvasStyle = displayGeometry.width > 0
    ? { width: `${displayGeometry.width}px`, height: `${displayGeometry.height}px` }
    : undefined;

  return <div className="annotation-editor" role="dialog" aria-modal="true" aria-label={`画像編集: ${target.filename}`}>
    <header className="annotation-editor__header">
      <strong>画像編集: {target.filename}</strong>
      <div className="annotation-editor__header-actions">
        <button type="button" disabled={state.undoStack.length === 0} onClick={() => dispatch({ type: "undo" })}>元に戻す</button>
        <button type="button" disabled={state.redoStack.length === 0} onClick={() => dispatch({ type: "redo" })}>やり直す</button>
        <button type="button" disabled={saving || !hasOutputChanges} onClick={() => void apply()}>{saving ? "保存中…" : "適用"}</button>
        <button type="button" disabled={saving} onClick={onCancel}>閉じる</button>
      </div>
    </header>

    <nav className="annotation-editor__toolbar" aria-label="画像編集ツール">
      {([
        ["select", "選択"],
        ["frame", "四角"],
        ["ellipse", "楕円"],
        ["arrow", "矢印"],
        ["mask", "マスク"],
        ["label", "ラベル"],
      ] as const).map(([value, label]) => <button
        key={value}
        type="button"
        className={tool === value ? "is-active" : ""}
        aria-pressed={tool === value}
        onClick={() => {
          dispatch({ type: "commitSelection" });
          setTool(value);
        }}
      ><span aria-hidden="true">{value === "select"
          ? <svg viewBox="0 0 24 24"><path d="M5 3l13 9-6 1.4 3.8 6.1-2.7 1.6-3.7-6.2L5 19V3z" /></svg>
          : value === "arrow"
            ? <svg viewBox="0 0 24 24"><path d="M4 12h14m-5-5 5 5-5 5" /></svg>
            : value === "frame" ? "□" : value === "ellipse" ? "○" : value === "mask" ? "▦" : "A"}</span>{label}</button>)}
    </nav>

    <aside className="annotation-editor__tools">
      <section>
        <h2>{selected ? "選択アイテム" : "スタンプサイズ"}</h2>
        <div className="annotation-editor__fields">
          <label>幅<input type="number" min="1" step="2" value={Math.round(selected?.width ?? width)} onChange={(event) => selected
            ? dispatch({ type: "resizeSelected", axis: "width", delta: Number(event.target.value) - selected.width, bounds: imageBounds() })
            : setWidth(Math.max(1, Number(event.target.value)))} /></label>
          <label>高さ<input type="number" min="1" step="2" value={Math.round(selected?.height ?? height)} onChange={(event) => selected
            ? dispatch({ type: "resizeSelected", axis: "height", delta: Number(event.target.value) - selected.height, bounds: imageBounds() })
            : setHeight(Math.max(1, Number(event.target.value)))} /></label>
        </div>
        <p className="annotation-editor__hint">ホイール: 高さ　Shift+ホイール: 幅<br />選択中: 拡縮、ドラッグ移動</p>
      </section>

      {(activeKind === "frame" || activeKind === "ellipse" || activeKind === "arrow") && <section>
        <h2>線</h2>
        <label>線幅<input type="number" min="1" value={selected?.type === "frame" || selected?.type === "ellipse" || selected?.type === "arrow" ? selected.lineWidth : lineWidth} onChange={(event) => selected?.type === "frame" || selected?.type === "ellipse" || selected?.type === "arrow" ? updateSelected({ lineWidth: Number(event.target.value) }) : setLineWidth(Math.max(1, Number(event.target.value)))} /></label>
      </section>}

      {activeKind === "arrow" && <section>
        <h2>矢印</h2>
        <label>向き<select value={selected?.type === "arrow" ? selected.direction : arrowDirection} onChange={(event) => selected?.type === "arrow" ? updateSelected({ direction: event.target.value }) : setArrowDirection(event.target.value as ArrowDirection)}>
          <option value="right">右</option><option value="down-right">右下</option><option value="down">下</option><option value="down-left">左下</option>
          <option value="left">左</option><option value="up-left">左上</option><option value="up">上</option><option value="up-right">右上</option>
        </select></label>
      </section>}

      {activeKind === "mask" && <section>
        <h2>マスク</h2>
        <label>方式<select value={selected?.type === "mask" ? selected.style : maskStyle} onChange={(event) => selected?.type === "mask" ? updateSelected({ style: event.target.value }) : setMaskStyle(event.target.value as MaskStyle)}>
          <option value="solid">単色</option><option value="blur">ぼかし</option><option value="mosaic">モザイク</option>
        </select></label>
      </section>}

      {activeKind === "label" && <section>
        <h2>ラベル</h2>
        <label>文字<input value={selected?.type === "label" ? selected.text : labelText} onChange={(event) => selected?.type === "label" ? updateSelected({ text: event.target.value }) : setLabelText(event.target.value)} /></label>
        <div className="annotation-editor__fields">
          <label>フォントサイズ<input type="number" min="1" value={selected?.type === "label" ? selected.fontSize : fontSize} onChange={(event) => updateFontSize(Number(event.target.value))} /></label>
          <label>文字色<input type="color" value={selected?.type === "label" ? selected.textColor : textColor} onChange={(event) => selected?.type === "label" ? updateSelected({ textColor: event.target.value }) : setTextColor(event.target.value)} /></label>
        </div>
      </section>}

      {activeKind && <section>
        <h2>{activeKind === "label" ? "背景色" : "色"}</h2>
        <div className="annotation-editor__palette">
          {RECOMMENDED_COLORS.map((paletteColor) => <button
            key={paletteColor}
            type="button"
            className={activeColor.toLowerCase() === paletteColor ? "is-active" : ""}
            style={{ "--annotation-color": paletteColor } as React.CSSProperties}
            aria-label={paletteColor}
            aria-pressed={activeColor.toLowerCase() === paletteColor}
            onClick={() => setActiveColor(paletteColor)}
          />)}
          <label className="annotation-editor__custom-color" title="カスタム色">
            <span>＋</span><input type="color" value={activeColor} onChange={(event) => setActiveColor(event.target.value)} />
          </label>
        </div>
      </section>}

      <section>
        <h2>画像差し替え</h2>
        <label>代わりの画像パス<input
          value={replacementPath}
          placeholder="C:\\images\\replacement.png"
          onChange={(event) => setReplacementPath(event.target.value)}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text/plain").trim();
            if (!IMAGE_PATH_PATTERN.test(text)) return;
            event.preventDefault();
            replaceFromPath(text);
          }}
        /></label>
        <div className="annotation-editor__replacement-actions">
          <button type="button" disabled={!replacementPath.trim()} onClick={() => replaceFromPath(replacementPath)}>パスを読み込む</button>
          <button type="button" onClick={() => replacementFileInputRef.current?.click()}>ファイルを選択</button>
        </div>
        <input
          ref={replacementFileInputRef}
          className="annotation-editor__replacement-file"
          type="file"
          accept="image/*,.svg"
          aria-label="差し替え画像ファイル"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) replaceFromFile(file);
            event.currentTarget.value = "";
          }}
        />
        <p className="annotation-editor__hint">画像ファイルまたはパスの貼り付け・ドロップにも対応します。</p>
        {replacementLabel && <output className="annotation-editor__replacement-status">差し替え候補: {replacementLabel}</output>}
      </section>

      <section>
        <h2>キャンバスサイズ</h2>
        <div className="annotation-editor__fields">
          <label>幅 (dot)<input type="number" min="1" value={Math.round(canvasGeometry.width)} onChange={(event) => setCanvasDimension("width", Number(event.target.value))} /></label>
          <label>高さ (dot)<input type="number" min="1" value={Math.round(canvasGeometry.height)} onChange={(event) => setCanvasDimension("height", Number(event.target.value))} /></label>
        </div>
        <p className="annotation-editor__hint">数値指定は四方へ均等に余白を追加します。<br />四辺ハンドルはその辺だけを変更します。</p>
      </section>

      <output>{cursor ? `${Math.round(cursor.x)}, ${Math.round(cursor.y)} px` : "—"}</output>
    </aside>

    <main className="annotation-editor__stage" onPointerDown={(event) => {
      if (event.target === event.currentTarget) dispatch({ type: "commitSelection" });
    }} onContextMenu={(event) => event.preventDefault()} onDragOver={(event) => {
      if (event.dataTransfer.types.includes("Files") || event.dataTransfer.types.includes("text/plain")) event.preventDefault();
    }} onDrop={(event) => {
      const file = [...event.dataTransfer.files].find((candidate) => candidate.type.startsWith("image/") || IMAGE_PATH_PATTERN.test(candidate.name));
      if (file) {
        event.preventDefault();
        replaceFromFile(file);
        return;
      }
      const path = event.dataTransfer.getData("text/plain").trim();
      if (IMAGE_PATH_PATTERN.test(path)) {
        event.preventDefault();
        replaceFromPath(path);
      }
    }}>
      <div className="annotation-editor__canvas-wrap">
        <img ref={imageRef} src={imageSource} alt="" hidden onLoad={(event) => {
          const size = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
          if (!originalSourceSizeRef.current) {
            originalSourceSizeRef.current = size;
            displayedImageSizeRef.current = size;
            setCanvasGeometry({ ...size, imageX: 0, imageY: 0 });
          } else if (replacementSource) {
            const previous = displayedImageSizeRef.current ?? originalSourceSizeRef.current;
            const left = canvasGeometry.imageX;
            const top = canvasGeometry.imageY;
            const right = canvasGeometry.width - left - previous.width;
            const bottom = canvasGeometry.height - top - previous.height;
            displayedImageSizeRef.current = size;
            setCanvasGeometry({
              width: Math.max(1, Math.round(size.width + left + right)),
              height: Math.max(1, Math.round(size.height + top + bottom)),
              imageX: left,
              imageY: top,
            });
          } else {
            originalSourceSizeRef.current = size;
            displayedImageSizeRef.current = size;
            render();
          }
        }} onError={() => {
          if (replacementSource) {
            onError(`差し替え画像を読み込めませんでした: ${replacementLabel ?? replacementSource}`);
            releaseReplacementObjectUrl();
            setReplacementSource(null);
            setReplacementLabel(null);
          } else {
            onError("元画像を読み込めませんでした。");
          }
        }} />
        <div className="annotation-editor__canvas-frame" style={canvasStyle}>
          <canvas
            ref={canvasRef}
            className={`is-tool-${tool}${dragRef.current ? " is-dragging" : ""}`}
            onPointerMove={moveCanvasPointer}
            onPointerLeave={() => { if (!dragRef.current) setCursor(null); }}
            onPointerDown={beginCanvasInteraction}
            onPointerUp={finishCanvasInteraction}
            onPointerCancel={(event) => {
              dragRef.current = null;
              setDragPreview(null);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onWheel={(event) => {
              event.preventDefault();
              const maximumWidth = event.currentTarget.width;
              const maximumHeight = event.currentTarget.height;
              const deltaPixels = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? Math.max(1, event.currentTarget.clientHeight) : 1);
              if (deltaPixels === 0) return;
              const delta = deltaPixels < 0 ? 2 : -2;
              if (selected) {
                dispatch({ type: "resizeSelected", axis: event.shiftKey ? "width" : "height", delta, bounds: imageBounds() });
              } else if (event.shiftKey) {
                setWidth((current) => Math.max(1, Math.min(maximumWidth, current + delta)));
              } else {
                setHeight((current) => Math.max(1, Math.min(maximumHeight, current + delta)));
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              const point = imagePoint(event);
              const hit = hitTestAnnotation(state.annotations, point.x, point.y);
              if (tool === "select" && hit) dispatch({ type: "select", id: hit.id });
              setContextMenu({ clientX: event.clientX, clientY: event.clientY, imageX: point.x, imageY: point.y, targetId: hit?.id ?? null });
            }}
          />
          {(["north", "east", "south", "west"] as const).map((edge) => <button
            key={edge}
            type="button"
            className={`annotation-editor__resize-handle is-${edge}`}
            aria-label={`${edge === "north" ? "上" : edge === "east" ? "右" : edge === "south" ? "下" : "左"}辺をドラッグしてキャンバスサイズを変更`}
            onPointerDown={(event) => beginCanvasResizeDrag(edge, event)}
            onPointerMove={moveCanvasResizeDrag}
            onPointerUp={finishCanvasResizeDrag}
            onPointerCancel={(event) => {
              canvasResizeDragRef.current = null;
              canvasResizePreviewRef.current = null;
              setCanvasResizePreview(null);
              if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          />)}
        </div>
      </div>
    </main>

    {contextMenu && <div
      ref={contextMenuRef}
      className="annotation-editor__context-menu"
      role="menu"
      style={{ left: contextMenu.clientX, top: contextMenu.clientY }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" disabled={!contextMenu.targetId} onClick={copyContextTarget}>コピー</button>
      <button type="button" role="menuitem" disabled={!contextMenu.targetId} onClick={cutContextTarget}>切り取り</button>
      <button type="button" role="menuitem" disabled={!clipboard} onClick={pasteContextTarget}>貼り付け</button>
      <div role="separator" />
      <button type="button" role="menuitem" className="is-danger" disabled={!contextMenu.targetId} onClick={() => {
        if (contextMenu.targetId) dispatch({ type: "delete", id: contextMenu.targetId });
        setContextMenu(null);
      }}>削除</button>
    </div>}

    {externalConflict && <div className="annotation-editor__conflict" role="alert">
      <p>編集中に画像が外部で変更されました。</p>
      <button type="button" onClick={() => {
        acceptedVersionRef.current = imageVersion;
        setExternalConflict(false);
        releaseReplacementObjectUrl();
        setReplacementSource(null);
        setReplacementLabel(null);
        originalSourceSizeRef.current = null;
        displayedImageSizeRef.current = null;
        setCanvasGeometry({ width: 0, height: 0, imageX: 0, imageY: 0 });
        setLoadedVersion(imageVersion);
        dispatch({ type: "reset" });
      }}>外部変更を読み込む</button>
      <button type="button" onClick={() => {
        acceptedVersionRef.current = imageVersion;
        setExternalConflict(false);
      }}>編集中の内容を維持</button>
    </div>}
  </div>;
}
