import { useEffect, useState } from "react";
import type { CropTarget } from "../hooks/useCropEditor";
import type { PresentationImageTarget } from "./ImageRenderer";

export function PresentationImageModal({
  target,
  onClose,
  onEdit,
}: {
  target: PresentationImageTarget;
  onClose: () => void;
  onEdit: (target: CropTarget) => void;
}) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <div className="presentation-image-modal" role="dialog" aria-modal="true" aria-label="画像の拡大表示" onClick={onClose}>
    <button type="button" className="presentation-image-modal__close" aria-label="拡大表示を閉じる" onClick={onClose}>×</button>
    <img
      src={target.src}
      alt={target.alt}
      style={{ transform: `scale(${scale})` }}
      title={target.cropTarget ? "もう一度クリックすると画像編集を開きます" : "ホイールで拡大・縮小できます"}
      onClick={(event) => {
        event.stopPropagation();
        if (target.cropTarget) onEdit(target.cropTarget);
      }}
      onWheel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setScale((current) => Math.min(5, Math.max(0.5, current + (event.deltaY < 0 ? 0.2 : -0.2))));
      }}
    />
    <output aria-live="polite">{Math.round(scale * 100)}%</output>
  </div>;
}
