import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CropTarget } from "../hooks/useCropEditor";
import { saveRenderedImage } from "../lib/commands";
import {
  createImageAnnotationState,
  drawImageAnnotations,
  hitTestAnnotation,
  imageAnnotationReducer,
  type ImageAnnotation,
  type MaskStyle,
} from "../lib/imageAnnotations";
import "../styles/image-annotation.css";

type Tool = "frame" | "ellipse" | "mask" | "label";

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
  const [state, dispatch] = useReducer(imageAnnotationReducer, undefined, () => createImageAnnotationState());
  const [tool, setTool] = useState<Tool>("frame");
  const [width, setWidth] = useState(320);
  const [height, setHeight] = useState(180);
  const [lineWidth, setLineWidth] = useState(6);
  const [color, setColor] = useState("#ef4444");
  const [maskStyle, setMaskStyle] = useState<MaskStyle>("solid");
  const [labelText, setLabelText] = useState("ラベル");
  const [textColor, setTextColor] = useState("#ffffff");
  const [backgroundColor, setBackgroundColor] = useState("#dc2626");
  const [fontSize, setFontSize] = useState(32);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [loadedVersion, setLoadedVersion] = useState(imageVersion);
  const [saving, setSaving] = useState(false);
  const [externalConflict, setExternalConflict] = useState(false);
  const lastRenderError = useRef<string | null>(null);
  const selected = useMemo(
    () => state.annotations.find((annotation) => annotation.id === state.selectedId),
    [state.annotations, state.selectedId],
  );
  const dirty = state.undoStack.length > 0;

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
      drawImageAnnotations(context, state.annotations);
      if (!selected && (cursor.x !== 0 || cursor.y !== 0)) {
        context.save(); context.globalAlpha = 0.62;
        drawImageAnnotations(context, [makeAnnotation(cursor.x, cursor.y)]);
        context.restore();
      }
      if (selected) {
        context.save(); context.strokeStyle = "#38bdf8"; context.lineWidth = Math.max(2, canvas.width / 500);
        context.setLineDash([10, 6]); context.strokeRect(selected.x, selected.y, selected.width, selected.height); context.restore();
      }
      lastRenderError.current = null;
    } catch (error) {
      const message = String(error);
      if (lastRenderError.current !== message) {
        lastRenderError.current = message;
        onError(`画像注釈のプレビューに失敗しました: ${message}`);
      }
    }
  };

  useEffect(render, [state.annotations, state.selectedId, loadedVersion, cursor, tool, width, height, lineWidth, color, maskStyle, labelText, textColor, backgroundColor, fontSize]);

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
    const keydown = (event: KeyboardEvent) => {
      const editingText = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === "Escape") {
        event.preventDefault();
        if (state.selectedId) dispatch({ type: "commitSelection" });
        else onCancel();
      } else if (event.key === "Enter" && !editingText) {
        event.preventDefault();
        dispatch({ type: "commitSelection" });
      } else if (event.key === "Delete" && !editingText) {
        event.preventDefault();
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
  }, [onCancel, state.selectedId]);

  const imagePoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width,
      y: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height,
    };
  };

  const makeAnnotation = (x: number, y: number): ImageAnnotation => {
    const common = {
      id: `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      x: x - width / 2,
      y: y - height / 2,
      width,
      height,
    };
    if (tool === "frame" || tool === "ellipse") return { ...common, type: tool, color, lineWidth };
    if (tool === "mask") return { ...common, type: "mask", style: maskStyle, color };
    return { ...common, type: "label", text: labelText, textColor, backgroundColor, fontSize };
  };

  const placeOrSelect = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = imagePoint(event);
    const hit = hitTestAnnotation(state.annotations, point.x, point.y);
    if (hit) {
      setTool(hit.type);
      dispatch({ type: "select", id: hit.id });
    } else if (selected) {
      dispatch({ type: "commitSelection" });
    } else dispatch({
      type: "place",
      annotation: makeAnnotation(point.x, point.y),
      bounds: { width: event.currentTarget.width, height: event.currentTarget.height },
    });
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
      onError(`画像注釈の保存に失敗しました: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const updateSelected = (changes: Record<string, string | number>) => {
    if (selected) dispatch({
      type: "update",
      changes,
      bounds: { width: canvasRef.current?.width ?? 0, height: canvasRef.current?.height ?? 0 },
    });
  };

  const imageSource = `${target.rawSrc}${target.rawSrc.includes("?") ? "&" : "?"}annotationVersion=${loadedVersion}`;
  return <div className="annotation-editor" role="dialog" aria-label={`画像注釈: ${target.filename}`}>
    <header className="annotation-editor__header">
      <strong>画像注釈: {target.filename}</strong>
      <div>
        <button type="button" disabled={state.undoStack.length === 0} onClick={() => dispatch({ type: "undo" })}>元に戻す</button>
        <button type="button" disabled={state.redoStack.length === 0} onClick={() => dispatch({ type: "redo" })}>やり直す</button>
        <button type="button" disabled={!selected} onClick={() => dispatch({ type: "delete" })}>削除</button>
        <button type="button" disabled={saving || state.annotations.length === 0} onClick={() => void apply()}>{saving ? "保存中…" : "適用"}</button>
        <button type="button" disabled={saving} onClick={onCancel}>閉じる</button>
      </div>
    </header>
    <aside className="annotation-editor__tools">
      <label>種類<select value={tool} onChange={(event) => setTool(event.target.value as Tool)}>
        <option value="frame">枠</option><option value="mask">マスク</option><option value="label">ラベル</option>
      </select></label>
      <label>幅<input type="number" min="1" value={selected?.width ?? width} onChange={(event) => selected ? updateSelected({ width: Number(event.target.value) }) : setWidth(Math.max(1, Number(event.target.value)))} /></label>
      <label>高さ<input type="number" min="1" value={selected?.height ?? height} onChange={(event) => selected ? updateSelected({ height: Number(event.target.value) }) : setHeight(Math.max(1, Number(event.target.value)))} /></label>
      {(tool === "frame" || tool === "ellipse") && <>
        <label>線幅<input type="number" min="1" value={selected?.type === "frame" || selected?.type === "ellipse" ? selected.lineWidth : lineWidth} onChange={(event) => selected?.type === "frame" || selected?.type === "ellipse" ? updateSelected({ lineWidth: Number(event.target.value) }) : setLineWidth(Math.max(1, Number(event.target.value)))} /></label>
        <label>色<input type="color" value={selected?.type === "frame" || selected?.type === "ellipse" ? selected.color : color} onChange={(event) => selected?.type === "frame" || selected?.type === "ellipse" ? updateSelected({ color: event.target.value }) : setColor(event.target.value)} /></label>
      </>}
      {tool === "mask" && <>
        <label>方式<select value={selected?.type === "mask" ? selected.style : maskStyle} onChange={(event) => selected?.type === "mask" ? updateSelected({ style: event.target.value }) : setMaskStyle(event.target.value as MaskStyle)}>
          <option value="solid">単色</option><option value="blur">ぼかし</option><option value="mosaic">モザイク</option>
        </select></label>
        <label>色<input type="color" value={selected?.type === "mask" ? selected.color : color} onChange={(event) => selected?.type === "mask" ? updateSelected({ color: event.target.value }) : setColor(event.target.value)} /></label>
      </>}
      {tool === "label" && <>
        <label>文字<input value={selected?.type === "label" ? selected.text : labelText} onChange={(event) => selected?.type === "label" ? updateSelected({ text: event.target.value }) : setLabelText(event.target.value)} /></label>
        <label>文字色<input type="color" value={selected?.type === "label" ? selected.textColor : textColor} onChange={(event) => selected?.type === "label" ? updateSelected({ textColor: event.target.value }) : setTextColor(event.target.value)} /></label>
        <label>背景色<input type="color" value={selected?.type === "label" ? selected.backgroundColor : backgroundColor} onChange={(event) => selected?.type === "label" ? updateSelected({ backgroundColor: event.target.value }) : setBackgroundColor(event.target.value)} /></label>
        <label>文字サイズ<input type="number" min="1" value={selected?.type === "label" ? selected.fontSize : fontSize} onChange={(event) => selected?.type === "label" ? updateSelected({ fontSize: Number(event.target.value) }) : setFontSize(Math.max(1, Number(event.target.value)))} /></label>
      </>}
      <p>{Math.round(cursor.x)}, {Math.round(cursor.y)} px</p>
    </aside>
    <main className="annotation-editor__stage" onPointerDown={(event) => {
      if (event.target === event.currentTarget) dispatch({ type: "commitSelection" });
    }}>
      <img
        ref={imageRef}
        src={imageSource}
        alt=""
        hidden
        onLoad={render}
      />
      <canvas
        ref={canvasRef}
        onPointerMove={(event) => setCursor(imagePoint(event))}
        onPointerDown={placeOrSelect}
        onWheel={(event) => {
          if (!selected) return;
          event.preventDefault();
          dispatch({
            type: "scaleSelected",
            scale: event.deltaY < 0 ? 1.08 : 1 / 1.08,
            bounds: { width: event.currentTarget.width, height: event.currentTarget.height },
          });
        }}
      />
    </main>
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
