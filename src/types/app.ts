export interface MarkdownLoadResult {
  path: string;
  kind: "markdown" | "svg" | "mermaid";
  content: string;
  base_dir: string;
  image_paths: string[];
  encoding: string;
  size_bytes: number;
  modified_at: string;
  revision: string;
  source?: "local" | "sharepoint";
  web_url?: string | null;
  etag?: string | null;
}

export interface SaveMarkdownRequest {
  path: string;
  content: string;
  expectedRevision: string;
}

export interface CropImageRequest {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  paddingMode?: "auto" | "transparent" | "white" | "gray" | "black";
  expectedSourceWidth?: number;
  expectedSourceHeight?: number;
}

export interface CropImageResult {
  path: string;
  backup_available: boolean;
  width: number;
  height: number;
}

export interface ToastState {
  id: string;
  message: string;
  type: 'info' | 'error' | 'success';
  restorePath?: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}
