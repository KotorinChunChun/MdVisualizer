import React, { useCallback, useEffect, useRef, useState } from "react";
import { cropImage } from "../lib/commands";
import { CropTarget } from "../hooks/useCropEditor";
import { cropBoxWithPadding, cropPixels, resizeCropBox, type CropHandle } from "../lib/cropGeometry";

interface CropOverlayProps {
  target: CropTarget;
  onApply: (filename: string, backupAvailable: boolean) => void;
  onCancel: () => void;
  onError: (message: string) => void;
  a4TargetWidth?: number;
  equalPadding?: number;
}

type PaddingMode = "auto" | "transparent" | "white" | "gray" | "black";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const CropOverlay: React.FC<CropOverlayProps> = ({
  target,
  onApply,
  onCancel,
  onError,
  a4TargetWidth = 3508,
  equalPadding = 32,
}) => {
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: 100, h: 100 });
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [displayedSize, setDisplayedSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [isSaving, setIsSaving] = useState(false);
  const supportsTransparency = /\.(?:png|webp|gif|tiff?|tga|avif)$/i.test(target.fullPath);
  const [paddingMode, setPaddingMode] = useState<PaddingMode>("auto");
  const [paddingPixels, setPaddingPixels] = useState({ top: equalPadding, right: equalPadding, bottom: equalPadding, left: equalPadding });

  const activeHandle = useRef<{
    type: CropHandle;
    startX: number;
    startY: number;
    startBox: Box;
  } | null>(null);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    setDisplayedSize({ w: img.clientWidth, h: img.clientHeight });
  };

  const handleMouseDown = (e: React.MouseEvent, type: CropHandle) => {
    e.preventDefault();
    e.stopPropagation();

    activeHandle.current = {
      type,
      startX: e.clientX,
      startY: e.clientY,
      startBox: { ...box },
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!activeHandle.current || !imgRef.current) return;
    const { type, startX, startY, startBox } = activeHandle.current;

    const imgRect = imgRef.current.getBoundingClientRect();
    if (imgRect.width === 0 || imgRect.height === 0) return;

    const dxPercent = ((e.clientX - startX) / imgRect.width) * 100;
    const dyPercent = ((e.clientY - startY) / imgRect.height) * 100;

    const minW = (20 / imgRect.width) * 100;
    const minH = (20 / imgRect.height) * 100;
    setBox(resizeCropBox(startBox, type, dxPercent, dyPercent, { w: minW, h: minH }, e.ctrlKey));
  }, []);

  const handleMouseUp = useCallback(() => {
    activeHandle.current = null;
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  const handleApply = useCallback(async () => {
    if (isSaving || naturalSize.w === 0 || naturalSize.h === 0) return;
    setIsSaving(true);

    try {
      const { x: cropX, y: cropY, width: cropW, height: cropH } = cropPixels(box, naturalSize);

      const res = await cropImage({
        path: target.fullPath,
        x: cropX,
        y: cropY,
        width: cropW,
        height: cropH,
        paddingMode,
        expectedSourceWidth: naturalSize.w,
        expectedSourceHeight: naturalSize.h,
      });

      onApply(target.filename, res.backup_available);
    } catch (err) {
      console.error("Failed to crop image:", err);
      onError(`画像クロップに失敗しました: ${String(err)}`);
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, naturalSize, box, paddingMode, target, onApply, onError]);

  const applyA4WidthPreset = () => {
    if (naturalSize.w === 0) return;
    if (naturalSize.w >= a4TargetWidth) {
      onError(`画像幅が設定値の${a4TargetWidth}px以上のため、A4横プリセットは適用できません。`);
      return;
    }
    const side = (a4TargetWidth - naturalSize.w) / 2;
    setPaddingMode(supportsTransparency ? "transparent" : "white");
    setBox({
      x: -(side / naturalSize.w) * 100,
      y: 0,
      w: (a4TargetWidth / naturalSize.w) * 100,
      h: 100,
    });
  };

  const applyEqualPaddingPreset = () => {
    if (naturalSize.w === 0 || naturalSize.h === 0) return;
    setBox(cropBoxWithPadding(naturalSize, paddingPixels));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleApply();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleApply, onCancel]);

  return (
    <div className="crop-overlay">
      <div className="crop-header">
        <span className="crop-title">📷 画像クロップ: {target.filename}</span>
        <div className="crop-header-actions">
          <label className="crop-padding-mode">
            余白色
            <select value={paddingMode} onChange={(event) => setPaddingMode(event.target.value as PaddingMode)} disabled={isSaving}>
              <option value="auto">自動</option>
              <option value="white">白</option>
              <option value="gray">灰</option>
              <option value="black">黒</option>
              <option value="transparent" disabled={!supportsTransparency}>透明</option>
            </select>
          </label>
          <button type="button" className="btn btn-secondary" onClick={applyA4WidthPreset} disabled={isSaving || naturalSize.w === 0}>
            A4横幅（{a4TargetWidth}px）
          </button>
          <fieldset className="crop-padding-sides" disabled={isSaving}>
            <legend>余白 px</legend>
            {(["top", "right", "bottom", "left"] as const).map((side) => <label key={side}>
              {{ top: "上", right: "右", bottom: "下", left: "左" }[side]}
              <input
                aria-label={`${{ top: "上", right: "右", bottom: "下", left: "左" }[side]}の余白`}
                type="number"
                min="0"
                value={paddingPixels[side]}
                onChange={(event) => setPaddingPixels((current) => ({ ...current, [side]: Math.max(0, Number(event.target.value) || 0) }))}
              />
            </label>)}
          </fieldset>
          <button type="button" className="btn btn-secondary" onClick={applyEqualPaddingPreset} disabled={isSaving || naturalSize.w === 0}>
            余白を適用
          </button>
          <button className="btn btn-primary" onClick={handleApply} disabled={isSaving}>
            {isSaving ? "保存中..." : "✅ 適用 (Enter)"}
          </button>
          <button className="btn btn-secondary" onClick={onCancel} disabled={isSaving}>
            ✕ キャンセル (Esc)
          </button>
        </div>
      </div>

      <div className="crop-stage">
        <div className="crop-container">
          <img
            ref={imgRef}
            src={target.rawSrc}
            alt={target.filename}
            className="crop-image"
            onLoad={handleImageLoad}
          />
          {displayedSize.w > 0 && (
            <div
              className="crop-box"
              style={{
                left: `${box.x}%`,
                top: `${box.y}%`,
                width: `${box.w}%`,
                height: `${box.h}%`,
              }}
              onMouseDown={(e) => handleMouseDown(e, "move")}
            >
              <div className="crop-box-border" />
              <button type="button" tabIndex={-1} aria-label="左上のクロップ境界" className="handle handle-nw" onMouseDown={(e) => handleMouseDown(e, "nw")} />
              <button type="button" tabIndex={-1} aria-label="上のクロップ境界" className="handle handle-n" onMouseDown={(e) => handleMouseDown(e, "n")} />
              <button type="button" tabIndex={-1} aria-label="右上のクロップ境界" className="handle handle-ne" onMouseDown={(e) => handleMouseDown(e, "ne")} />
              <button type="button" tabIndex={-1} aria-label="右のクロップ境界" className="handle handle-e" onMouseDown={(e) => handleMouseDown(e, "e")} />
              <button type="button" tabIndex={-1} aria-label="右下のクロップ境界" className="handle handle-se" onMouseDown={(e) => handleMouseDown(e, "se")} />
              <button type="button" tabIndex={-1} aria-label="下のクロップ境界" className="handle handle-s" onMouseDown={(e) => handleMouseDown(e, "s")} />
              <button type="button" tabIndex={-1} aria-label="左下のクロップ境界" className="handle handle-sw" onMouseDown={(e) => handleMouseDown(e, "sw")} />
              <button type="button" tabIndex={-1} aria-label="左のクロップ境界" className="handle handle-w" onMouseDown={(e) => handleMouseDown(e, "w")} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
