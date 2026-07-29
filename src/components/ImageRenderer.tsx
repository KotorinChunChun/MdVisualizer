import React, { useState } from "react";
import { getCacheBusterUrl } from "../lib/image";
import { getFileName, isAbsoluteLocalPath, resolveImageSrc } from "../lib/path";
import { CropTarget } from "../hooks/useCropEditor";
import { InlineImageResizeOverlay } from "./InlineImageResizeOverlay";
import { ImageSize, useInlineImageResize } from "../hooks/useInlineImageResize";
import "../styles/inline-image-resize.css";

interface ImageRendererProps {
  src?: string;
  alt?: string;
  baseDir: string;
  imageVersions: Record<string, number>;
  onStartCrop: (target: CropTarget) => void;
  /** Optional controlled display size; callers can persist this per tab without changing image data. */
  displaySize?: ImageSize | null;
  onDisplaySizeChange?: (size: ImageSize) => void;
}

export const ImageRenderer: React.FC<ImageRendererProps> = ({
  src = "",
  alt = "",
  baseDir,
  imageVersions,
  onStartCrop,
  displaySize,
  onDisplaySizeChange,
}) => {
  const [loadError, setLoadError] = useState(false);
  const {
    imageRef,
    size,
    isResizing,
    setInitialSize,
    startResize,
    resizeFromKeyboard,
    consumeResizeClick,
  } = useInlineImageResize({ resetKey: src, size: displaySize, onSizeChange: onDisplaySizeChange });

  if (!src) return null;

  const resolvedSrc = resolveImageSrc(src, baseDir);
  const isRemote =
    src.toLowerCase().startsWith("http://") ||
    src.toLowerCase().startsWith("https://") ||
    src.toLowerCase().startsWith("data:");
  const isSvg = /\.svg(?:[?#]|$)/i.test(src);
  // SVG is display-only until a dedicated vector editing design is approved.
  const isEditableLocalImage = !isRemote && !src.toLowerCase().startsWith("file:") && !isSvg;

  let fullPath = src;
  if (!isRemote && !isAbsoluteLocalPath(src)) {
    const normalizedBase = baseDir.replace(/\\/g, "/").replace(/\/$/, "");
    const normalizedSrc = src.replace(/\\/g, "/").replace(/^\.\//, "");
    fullPath = `${normalizedBase}/${normalizedSrc}`;
  }

  const version = imageVersions[fullPath] || 0;
  const displaySrc = getCacheBusterUrl(resolvedSrc, version);

  if (loadError) {
    return (
      <span className="image-error-fallback">
        ⚠️ 画像を読み込めません: {src}
      </span>
    );
  }

  const handleClick = (e: React.MouseEvent) => {
    if (consumeResizeClick()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!isEditableLocalImage) return;
    e.preventDefault();
    e.stopPropagation();

    onStartCrop({
      rawSrc: displaySrc,
      fullPath,
      filename: getFileName(fullPath),
    });
  };

  return (
    <span
      className={`inline-image-resize ${isResizing ? "is-resizing" : ""}`}
      style={size ? { width: `${size.width}px`, height: `${size.height}px` } : undefined}
    >
      <img
        ref={imageRef}
        src={displaySrc}
        alt={alt}
        className={`markdown-img inline-image-resize__image ${isEditableLocalImage ? "croppable" : ""}`}
        title={isEditableLocalImage ? "クリックしてクロップ編集。枠のハンドルをドラッグして表示サイズを縮小" : alt}
        onLoad={setInitialSize}
        onClick={handleClick}
        onError={() => setLoadError(true)}
      />
      {isEditableLocalImage && (
        <InlineImageResizeOverlay
          onPointerDown={startResize}
          onKeyDown={resizeFromKeyboard}
        />
      )}
    </span>
  );
};
