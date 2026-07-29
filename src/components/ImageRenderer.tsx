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
  presentationMode?: boolean;
  onPresentationOpen?: (target: PresentationImageTarget) => void;
}

export interface PresentationImageTarget {
  src: string;
  alt: string;
  cropTarget: CropTarget | null;
}

export const ImageRenderer: React.FC<ImageRendererProps> = ({
  src = "",
  alt = "",
  baseDir,
  imageVersions,
  onStartCrop,
  displaySize,
  onDisplaySizeChange,
  presentationMode = false,
  onPresentationOpen,
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
    src.toLowerCase().startsWith("data:") ||
    src.toLowerCase().startsWith("file:") ||
    src.startsWith("//");
  const isSupportedRaster = /\.(?:png|jpe?g|gif|webp|bmp)(?:[?#]|$)/i.test(src);
  // SVG is display-only until a dedicated vector editing design is approved.
  const isEditableLocalImage = !isRemote && isSupportedRaster;

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
    e.preventDefault();
    e.stopPropagation();

    const cropTarget = isEditableLocalImage ? {
      rawSrc: displaySrc,
      fullPath,
      filename: getFileName(fullPath),
    } : null;
    if (presentationMode) {
      onPresentationOpen?.({ src: displaySrc, alt, cropTarget });
      return;
    }
    if (cropTarget) onStartCrop(cropTarget);
  };

  return (
    <span
      className={`inline-image-resize ${isResizing ? "is-resizing" : ""} ${presentationMode ? "is-presentation" : ""}`}
      style={!presentationMode && size ? { width: `${size.width}px`, height: `${size.height}px` } : undefined}
    >
      <img
        ref={imageRef}
        src={displaySrc}
        alt={alt}
        className={`markdown-img inline-image-resize__image ${isEditableLocalImage ? "croppable" : ""}`}
        title={presentationMode ? "クリックして拡大表示" : isEditableLocalImage ? "クリックしてクロップ編集。枠のハンドルをドラッグして表示サイズを縮小" : alt}
        onLoad={setInitialSize}
        onClick={handleClick}
        onError={() => setLoadError(true)}
      />
      {isEditableLocalImage && !presentationMode && (
        <InlineImageResizeOverlay
          onPointerDown={startResize}
          onKeyDown={resizeFromKeyboard}
        />
      )}
    </span>
  );
};
