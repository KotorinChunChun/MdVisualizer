import React, { useState } from "react";
import { getCacheBusterUrl } from "../lib/image";
import { getFileName, isAbsoluteLocalPath, resolveImageSrc } from "../lib/path";
import type { CropTarget } from "../hooks/useCropEditor";
import { InlineImageResizeOverlay } from "./InlineImageResizeOverlay";
import { ImageSize, useInlineImageResize } from "../hooks/useInlineImageResize";
import type { MediaPreviewTarget } from "./MediaPreviewModal";
import "../styles/inline-image-resize.css";

interface ImageRendererProps {
  src?: string;
  alt?: string;
  baseDir: string;
  imageVersions: Record<string, number>;
  /** Optional controlled display size; callers can persist this per tab without changing image data. */
  displaySize?: ImageSize | null;
  onDisplaySizeChange?: (size: ImageSize) => void;
  presentationMode?: boolean;
  onMediaOpen?: (target: MediaPreviewTarget) => void;
  occurrenceId?: string;
  sourceLine?: number;
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
  displaySize,
  onDisplaySizeChange,
  presentationMode = false,
  onMediaOpen,
  occurrenceId,
  sourceLine,
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
    onMediaOpen?.({
      content: { kind: "image", src: displaySrc, alt },
      cropTarget,
    });
  };

  return (
    <span
      id={occurrenceId}
      data-image-occurrence-id={occurrenceId}
      data-source-line={sourceLine}
      className={`inline-image-resize ${isResizing ? "is-resizing" : ""} ${presentationMode ? "is-presentation" : ""}`}
      style={!presentationMode && size ? { width: `${size.width}px`, height: `${size.height}px` } : undefined}
    >
      <img
        ref={imageRef}
        src={displaySrc}
        alt={alt}
        className={`markdown-img inline-image-resize__image ${isEditableLocalImage ? "croppable" : ""}`}
        title={isEditableLocalImage ? "クリックして拡大表示。プレビューでもう一度クリックするとクロップ編集" : "クリックして拡大表示"}
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
