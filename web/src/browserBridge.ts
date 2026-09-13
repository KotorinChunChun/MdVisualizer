import type { AssetWorkspace, StoredAsset } from "./workspace";

type Bridge = {
  workspace: AssetWorkspace;
  documentPath: () => string;
  updateAsset: (path: string, text: string, blob?: Blob) => void;
};

let bridge: Bridge | undefined;

export function configureBrowserBridge(next: Bridge): void { bridge = next; }
export function browserBridge(): Bridge {
  if (!bridge) throw new Error("Web資産ワークスペースを初期化していません。");
  return bridge;
}
export function replaceAsset(assets: StoredAsset[], path: string, text: string, blob?: Blob): StoredAsset[] {
  if (!assets.some(asset => asset.path === path)) throw new Error(`資産を見つけられません: ${path}`);
  return assets.map(asset => asset.path === path ? { ...asset, blob: blob ?? new Blob([text], { type: asset.blob.type || "text/plain;charset=utf-8" }) } : asset);
}
