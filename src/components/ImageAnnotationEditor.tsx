import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CropTarget } from "../hooks/useCropEditor";
import { saveRenderedImage } from "../lib/commands";
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

type CanvasEdge = "north" | "east" | "south" | "west";

interface CanvasScaleDragState {
  edge: CanvasEdge;
  pointerId: number;
  startX: number;
  startY: number;
  startScale: number;
  baseWidth: number;
  baseHeight: number;
}

const RECOMMENDED_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6"];
const MIN_CANVAS_SCALE = 10;
const MAX_CANVAS_SCALE = 400;
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
  const dragRef = useRef<DragState | null>(null);
  const canvasScaleDragRef = useRef<CanvasScaleDragState | null>(null);
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
  const [canvasScale, setCanvasScale] = useState(100);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [clipboard, setClipboard] = useState<ImageAnnotation | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [loadedVersion, setLoadedVersion] = useState(imageVersion);
  const [saving, setSaving] = useState(false);
  const [externalConflict, setExternalConflict] = useState(false);
  const lastRenderError = useRef<string | null>(null);
  const selected = useMemo(
    () => state.annotations.find((annotation) => annotation.id === state.selectedId),
    [state.annotations, state.selectedId],
  );
  const activeKind = selected?.type ?? (tool === "select" ? null : tool);
  const dirty = state.undoStack.length > 0;
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

  const imageBounds = () => ({
    width: canvasRef.current?.width ?? 0,
    height: canvasRef.current?.height ?? 0,
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

  const effectiveAnnotations = dragPreview
    ? state.annotations.map((annotation) => annotation.id === dragPreview.id
      ? { ...annotation, x: dragPreview.x, y: dragPreview.y }
      : annotation) as ImageAnnotation[]
    : state.annotations;
  const effectiveSelected = dragPreview && selected?.id === dragPreview.id
    ? { ...selected, x: dragPreview.x, y: dragPreview.y }
    : selected;

  const render = () => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !image.complete || image.naturalWidth === 0) return;
    try {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(image, 0, 0);
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

  useEffect(render, [state.annotations, state.selectedId, loadedVersion, cursor, dragPreview, tool, width, height, lineWidth, color, arrowDirection, maskStyle, labelText, textColor, backgroundColor, fontSize]);

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
      output.width = image.naturalWidth;
      output.height = image.naturalHeight;
      const context = output.getContext("2d");
      if (!context) throw new Error("画像キャンバスを作成できません。");
      context.drawImage(image, 0, 0);
      drawImageAnnotations(context, state.annotations);
      const blob = await new Promise<Blob>((resolve, reject) =>
        output.toBlob((value) => value ? resolve(value) : reject(new Error("画像をPNGへ変換できません。")), "image/png"),
      );
      const result = await saveRenderedImage({
        path: target.fullPath,
        pngBytes: [...new Uint8Array(await blob.arrayBuffer())],
        expectedSourceWidth: image.naturalWidth,
        expectedSourceHeight: image.naturalHeight,
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

  const setScale = (value: number) => setCanvasScale(Math.round(clamp(value, MIN_CANVAS_SCALE, MAX_CANVAS_SCALE)));
  const beginCanvasScaleDrag = (edge: CanvasEdge, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    canvasScaleDragRef.current = {
      edge,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScale: canvasScale,
      baseWidth: Math.max(1, canvasSize.width || canvasRef.current?.width || 1),
      baseHeight: Math.max(1, canvasSize.height || canvasRef.current?.height || 1),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveCanvasScaleDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = canvasScaleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = drag.edge === "east"
      ? (event.clientX - drag.startX) / drag.baseWidth * 100
      : drag.edge === "west"
        ? (drag.startX - event.clientX) / drag.baseWidth * 100
        : drag.edge === "south"
          ? (event.clientY - drag.startY) / drag.baseHeight * 100
          : (drag.startY - event.clientY) / drag.baseHeight * 100;
    setScale(drag.startScale + delta);
  };
  const finishCanvasScaleDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = canvasScaleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    canvasScaleDragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const imageSource = `${target.rawSrc}${target.rawSrc.includes("?") ? "&" : "?"}annotationVersion=${loadedVersion}`;
  const canvasStyle = canvasSize.width > 0
    ? { width: `${canvasSize.width * canvasScale / 100}px`, height: `${canvasSize.height * canvasScale / 100}px` }
    : undefined;

  return <div className="annotation-editor" role="dialog" aria-modal="true" aria-label={`画像編集: ${target.filename}`}>
    <header className="annotation-editor__header">
      <strong>画像編集: {target.filename}</strong>
      <div className="annotation-editor__header-actions">
        <button type="button" disabled={state.undoStack.length === 0} onClick={() => dispatch({ type: "undo" })}>元に戻す</button>
        <button type="button" disabled={state.redoStack.length === 0} onClick={() => dispatch({ type: "redo" })}>やり直す</button>
        <button type="button" disabled={saving || state.annotations.length === 0} onClick={() => void apply()}>{saving ? "保存中…" : "適用"}</button>
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
        <h2>キャンバスサイズ</h2>
        <div className="annotation-editor__scale-controls">
          <button type="button" aria-label="キャンバスを縮小" onClick={() => setScale(canvasScale - 10)}>−</button>
          <label><input type="number" min={MIN_CANVAS_SCALE} max={MAX_CANVAS_SCALE} value={canvasScale} onChange={(event) => setScale(Number(event.target.value))} /><span>%</span></label>
          <button type="button" aria-label="キャンバスを拡大" onClick={() => setScale(canvasScale + 10)}>＋</button>
        </div>
      </section>

      <output>{cursor ? `${Math.round(cursor.x)}, ${Math.round(cursor.y)} px` : "—"}</output>
    </aside>

    <main className="annotation-editor__stage" onPointerDown={(event) => {
      if (event.target === event.currentTarget) dispatch({ type: "commitSelection" });
    }} onContextMenu={(event) => event.preventDefault()}>
      <div className="annotation-editor__canvas-wrap">
        <img ref={imageRef} src={imageSource} alt="" hidden onLoad={(event) => {
          setCanvasSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
          render();
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
            onPointerDown={(event) => beginCanvasScaleDrag(edge, event)}
            onPointerMove={moveCanvasScaleDrag}
            onPointerUp={finishCanvasScaleDrag}
            onPointerCancel={(event) => {
              canvasScaleDragRef.current = null;
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
