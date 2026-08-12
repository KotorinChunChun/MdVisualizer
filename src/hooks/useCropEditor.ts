import { useCallback, useState } from "react";

export interface CropTarget {
  rawSrc: string;
  fullPath: string;
  filename: string;
}

export interface ImageEditTarget {
  rawSrc: string;
  filename: string;
  storage: "external" | "embedded";
  fullPath?: string;
  conversionContext?: import("../lib/assetConversion").AssetConversionContext;
}

export function useCropEditor() {
  const [cropTarget, setCropTarget] = useState<CropTarget | null>(null);

  const startCrop = useCallback((target: CropTarget) => {
    setCropTarget(target);
  }, []);

  const cancelCrop = useCallback(() => {
    setCropTarget(null);
  }, []);

  return {
    cropTarget,
    startCrop,
    cancelCrop,
  };
}
