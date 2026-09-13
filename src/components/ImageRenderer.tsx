import React, { useEffect, useState, useRef } from "react";
import { getCacheBusterUrl } from "../lib/image";
import { getFileName, resolveImageSrc, resolveLocalImagePath } from "../lib/path";
import { readDocumentAsset } from "../lib/commands";
import { sanitizeSvgXml } from "../lib/svgSafety";
import type { CropTarget } from "../hooks/useCropEditor";
import { InlineImageResizeOverlay } from "./InlineImageResizeOverlay";
import { ImageSize, useInlineImageResize } from "../hooks/useInlineImageResize";
import type { MediaPreviewTarget } from "./MediaPreviewModal";
import { normalizedAssetFilename, parseRasterDataUri, type AssetConversionContext } from "../lib/assetConversion";
import type { DocumentAssetData } from "../types/app";
import { ExternalFileHeader } from "./ExternalFileHeader";
import "../styles/inline-image-resize.css";
import { FileSvgCodexAction } from "../features/codex/FileSvgCodexAction";

interface ImageRendererProps {
  src?: string;
  alt?: string;
  baseDir: string;
  imageVersions: Record<string, number>;
  /** Optional controlled display size; callers can persist this per tab without changing image data. */
  displaySize?: ImageSize | null;
  onDisplaySizeChange?: (size: ImageSize) => void;
  presentationMode?: boolean;
  headingMode?: boolean;
  onMediaOpen?: (target: MediaPreviewTarget) => void;
  occurrenceId?: string;
  sourceLine?: number;
  markdownPath?: string;
  documentSourcePath?: string;
  sourceOffset?: number;
  conversionContext?: AssetConversionContext;
  previewSrc?: string;
  onExternalRename?: (filename: string) => boolean | void | Promise<boolean | void>;
  onError?: (message: string) => void;
  onCodexSelect?: () => void;
  codexSvgEditable?: boolean;
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
  headingMode = false,
  onMediaOpen,
  occurrenceId,
  sourceLine,
  markdownPath,
  documentSourcePath,
  sourceOffset,
  conversionContext,
  previewSrc,
  onExternalRename,
  onError,
  onCodexSelect: _onCodexSelect,
  codexSvgEditable = false,
}) => {
  const [loadError, setLoadError] = useState(false);
  const [codexVersion, setCodexVersion] = useState(0);
  const [authenticatedSrc, setAuthenticatedSrc] = useState<string | null>(null);
  const [authenticatedAsset, setAuthenticatedAsset] = useState<DocumentAssetData | null>(null);
  const [authenticatedLoading, setAuthenticatedLoading] = useState(false);
  const stageRef = useRef<HTMLSpanElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const assetDocumentPath = documentSourcePath ?? markdownPath;
  const isSharePointAsset = Boolean(
    assetDocumentPath?.toLowerCase().startsWith("spmd:") &&
    src &&
    !/^(?:[a-z][a-z0-9+.-]*:|\/|\\|\/\/)/i.test(src) &&
    /\.(?:png|svg)$/i.test(src),
  );
  const authenticatedVersion = imageVersions[`${assetDocumentPath ?? ""}|${src}`] ?? 0;

  useEffect(() => {
    setLoadError(false);
    setAuthenticatedSrc(null);
    setAuthenticatedAsset(null);
    if (!isSharePointAsset || !assetDocumentPath || previewSrc) {
      setAuthenticatedLoading(false);
      return;
    }
    let active = true;
    setAuthenticatedLoading(true);
    void readDocumentAsset(assetDocumentPath, src)
      .then((asset) => {
        if (!active) return;
        setAuthenticatedAsset(asset);
        if (asset.mediaType === "image/svg+xml") {
          const safeSvg = sanitizeSvgXml(asset.text ?? "");
          setAuthenticatedSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(safeSvg)}`);
        } else if (asset.mediaType === "image/png") {
          setAuthenticatedSrc(`data:image/png;base64,${asset.base64}`);
        } else {
          throw new Error("未対応のSharePoint画像形式です。");
        }
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setAuthenticatedLoading(false);
      });
    return () => { active = false; };
  }, [assetDocumentPath, authenticatedVersion, isSharePointAsset, previewSrc, src]);
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

  const resolvedSrc = previewSrc ?? authenticatedSrc ?? (isSharePointAsset ? "" : resolveImageSrc(src, baseDir));
  const isRemote =
    src.toLowerCase().startsWith("http://") ||
    src.toLowerCase().startsWith("https://") ||
    src.toLowerCase().startsWith("data:") ||
    src.toLowerCase().startsWith("file:") ||
    src.startsWith("//");
  const isSupportedRaster = /\.(?:png|jpe?g|gif|webp|bmp)(?:[?#]|$)/i.test(src);
  const isEmbeddedRaster = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i.test(src);
  // SVG is display-only until a dedicated vector editing design is approved.
  const isEditableLocalImage = !previewSrc && !isSharePointAsset && !isRemote && isSupportedRaster;
  const canInlineResize = isEditableLocalImage && !presentationMode && !headingMode;
  const hasDisplaySize = !headingMode && Boolean(size);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const update = () => setStageWidth(stage.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [size?.width, src, headingMode]);

  const fullPath = isRemote ? src : resolveLocalImagePath(src, baseDir) ?? src;

  const version = (imageVersions[fullPath] || 0) + codexVersion;
  const displaySrc = getCacheBusterUrl(resolvedSrc, version);

  if (authenticatedLoading || (isSharePointAsset && !authenticatedSrc && !loadError)) {
    return <span className="image-loading-placeholder">画像を読み込んでいます…</span>;
  }

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
    const editTarget = cropTarget
      ? { ...cropTarget, storage: "external" as const, conversionContext }
      : authenticatedAsset?.canEdit && authenticatedAsset.mediaType === "image/png" && authenticatedAsset.path && authenticatedAsset.revision && assetDocumentPath
        ? {
          rawSrc: displaySrc,
          filename: authenticatedAsset.filename,
          storage: "sharepoint" as const,
          sharePoint: {
            documentPath: assetDocumentPath,
            source: src,
            path: authenticatedAsset.path,
            revision: authenticatedAsset.revision,
            mediaType: "image/png" as const,
          },
        }
      : isEmbeddedRaster && conversionContext
        ? {
          rawSrc: displaySrc,
          filename: normalizedAssetFilename(alt, parseRasterDataUri(src)?.extension ?? "png"),
          storage: "embedded" as const,
          conversionContext,
        }
        : null;
    const safeSharePointSvg = authenticatedAsset?.mediaType === "image/svg+xml" && authenticatedAsset.text
      ? sanitizeSvgXml(authenticatedAsset.text)
      : null;
    onMediaOpen?.({
      content: safeSharePointSvg ? { kind: "svg", svg: safeSharePointSvg, alt } : { kind: "image", src: displaySrc, alt },
      cropTarget,
      editTarget,
      imageContext: markdownPath && sourceOffset !== undefined ? {
        markdownPath,
        imagePath: isEmbeddedRaster ? normalizedAssetFilename(alt, parseRasterDataUri(src)?.extension ?? "png") : fullPath,
        source: src,
        sourceOffset,
        caption: alt,
      } : undefined,
      headingTitle: alt.trim() || undefined,
      conversionContext,
      svgEditTarget: authenticatedAsset?.canEdit && safeSharePointSvg && authenticatedAsset.path && authenticatedAsset.revision && assetDocumentPath
        ? {
          documentPath: assetDocumentPath,
          source: src,
          path: authenticatedAsset.path,
          revision: authenticatedAsset.revision,
          mediaType: "image/svg+xml",
          svg: safeSharePointSvg,
          filename: authenticatedAsset.filename,
        }
        : undefined,
      editDisabledReason: isSharePointAsset && authenticatedAsset && !authenticatedAsset.canEdit
        ? authenticatedAsset.editDisabledReason ?? "このSharePoint画像は編集できません。"
        : undefined,
    });
  };

  return (
    <span
      id={occurrenceId}
      data-image-occurrence-id={occurrenceId}
      data-source-line={sourceLine}
      className={`inline-image-resize ${hasDisplaySize ? "has-display-size" : ""} ${isResizing ? "is-resizing" : ""} ${presentationMode ? "is-presentation" : ""} ${headingMode ? "is-heading" : ""}`}
      style={!presentationMode && !headingMode && size ? { width: `${size.width}px` } : undefined}
    >
      {!headingMode && !presentationMode && !isRemote && onExternalRename && <ExternalFileHeader
        source={src}
        path={fullPath}
        status={previewSrc ? "未保存" : version > 0 ? "更新あり" : undefined}
        onRename={onExternalRename}
        onError={onError}
      />}
      <span
        className="inline-image-resize__stage"
        ref={stageRef}
        style={!presentationMode && !headingMode && size ? {
          height: `${size.height * (stageWidth > 0 && size.width > 0 ? Math.min(1, stageWidth / size.width) : 1)}px`,
        } : undefined}
      >
        <img
          ref={imageRef}
          src={displaySrc}
          alt={alt}
          className={`markdown-img inline-image-resize__image ${isEditableLocalImage ? "croppable" : ""}`}
          title={isEditableLocalImage ? "クリックして拡大表示。プレビューでもう一度クリックするとクロップ編集" : "クリックして拡大表示"}
          onLoad={headingMode ? undefined : setInitialSize}
          onClick={handleClick}
          onError={() => setLoadError(true)}
        />
        {canInlineResize && (
          <InlineImageResizeOverlay
            onPointerDown={startResize}
            onKeyDown={resizeFromKeyboard}
          />
        )}
      </span>
      {!headingMode && alt.trim() && <span className="inline-image-resize__caption">{alt}</span>}
      {!headingMode && !presentationMode && codexSvgEditable && !isRemote && !previewSrc && /\.svg$/i.test(src) && <FileSvgCodexAction path={fullPath} onSaved={() => setCodexVersion((value) => value + 1)} />}
    </span>
  );
};
