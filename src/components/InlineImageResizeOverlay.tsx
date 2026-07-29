import React from "react";
import {
  IMAGE_RESIZE_HANDLES,
  ImageResizeHandle,
} from "../hooks/useInlineImageResize";

interface InlineImageResizeOverlayProps {
  onPointerDown: (handle: ImageResizeHandle, event: React.PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (handle: ImageResizeHandle, event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

const labels: Record<ImageResizeHandle, string> = {
  nw: "左上を調整",
  n: "上辺を調整",
  ne: "右上を調整",
  e: "右辺を調整",
  se: "右下を調整",
  s: "下辺を調整",
  sw: "左下を調整",
  w: "左辺を調整",
};

export const InlineImageResizeOverlay: React.FC<InlineImageResizeOverlayProps> = ({
  onPointerDown,
  onKeyDown,
}) => (
  <span className="inline-image-resize__overlay" aria-label="画像の表示サイズを調整">
    {IMAGE_RESIZE_HANDLES.map((handle) => (
      <button
        key={handle}
        type="button"
        className={`inline-image-resize__handle inline-image-resize__handle--${handle}`}
        aria-label={labels[handle]}
        title={`${labels[handle]}（矢印キーでも調整）`}
        onPointerDown={(event) => onPointerDown(handle, event)}
        onKeyDown={(event) => onKeyDown(handle, event)}
      />
    ))}
  </span>
);
