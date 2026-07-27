import React, { useState } from "react";
import { getCacheBusterUrl } from "../lib/image";
import { getFileName, resolveImageSrc } from "../lib/path";
import { CropTarget } from "../hooks/useCropEditor";

interface ImageRendererProps {
  src?: string;
  alt?: string;
  baseDir: string;
  imageVersions: Record<string, number>;
  onStartCrop: (target: CropTarget) => void;
}

export const ImageRenderer: React.FC<ImageRendererProps> = ({
  src = "",
  alt = "",
  baseDir,
  imageVersions,
  onStartCrop,
}) => {
  const [loadError, setLoadError] = useState(false);

  if (!src) return null;

  const resolvedSrc = resolveImageSrc(src, baseDir);
  const isRemote =
    src.toLowerCase().startsWith("http://") ||
    src.toLowerCase().startsWith("https://") ||
    src.toLowerCase().startsWith("data:");

  let fullPath = src;
  if (!isRemote && !src.startsWith("/") && !src.includes(":\\")) {
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
    if (isRemote) return;
    e.preventDefault();
    e.stopPropagation();

    onStartCrop({
      rawSrc: displaySrc,
      fullPath,
      filename: getFileName(fullPath),
    });
  };

  return (
    <img
      src={displaySrc}
      alt={alt}
      className={`markdown-img ${!isRemote ? "croppable" : ""}`}
      title={!isRemote ? "クリックしてクロップ編集" : alt}
      onClick={handleClick}
      onError={() => setLoadError(true)}
    />
  );
};
