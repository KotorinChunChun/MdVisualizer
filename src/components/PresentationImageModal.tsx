import type { CropTarget } from "../hooks/useCropEditor";
import type { PresentationImageTarget } from "./ImageRenderer";
import { MediaPreviewModal } from "./MediaPreviewModal";

export function PresentationImageModal({
  target,
  onClose,
  onEdit,
}: {
  target: PresentationImageTarget;
  onClose: () => void;
  onEdit: (target: CropTarget) => void;
}) {
  return <MediaPreviewModal
    content={{ kind: "image", src: target.src, alt: target.alt }}
    onClose={onClose}
    onActivate={target.cropTarget ? () => onEdit(target.cropTarget!) : undefined}
  />;
}
