export interface MarkdownLoadResult {
  path: string;
  content: string;
  base_dir: string;
  image_paths: string[];
  encoding: string;
  size_bytes: number;
  modified_at: string;
}

export interface CropImageRequest {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
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
}
