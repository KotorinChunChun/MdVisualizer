use crate::backup::BackupManager;
use crate::errors::{AppError, AppResult};
use image::{GenericImageView, ImageFormat};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Deserialize, Debug)]
pub struct CropImageRequest {
    pub path: String,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Debug)]
pub struct CropImageResult {
    pub path: String,
    pub backup_available: bool,
    pub width: u32,
    pub height: u32,
}

pub fn crop_image(req: CropImageRequest, backup_mgr: &BackupManager) -> AppResult<CropImageResult> {
    let original_path = PathBuf::from(&req.path);
    if !original_path.exists() {
        return Err(AppError::FileNotFound(req.path.clone()));
    }

    // 1. クロップ前に元画像を一時バックアップへ退避
    let _backup_path = backup_mgr.ensure_backup(&original_path)?;

    // 2. 画像の読み込み
    let img = image::open(&original_path)
        .map_err(|e| AppError::ImageError(format!("Failed to open image: {}", e)))?;

    let (orig_w, orig_h) = img.dimensions();
    let crop_x = req.x.min(orig_w.saturating_sub(1));
    let crop_y = req.y.min(orig_h.saturating_sub(1));
    let crop_w = req.width.min(orig_w - crop_x).max(1);
    let crop_h = req.height.min(orig_h - crop_y).max(1);

    // 3. クロップ処理
    let cropped = img.crop_imm(crop_x, crop_y, crop_w, crop_h);

    // 4. 安全な上書き保存 (一時ファイル経由の置換)
    let parent = original_path
        .parent()
        .ok_or_else(|| AppError::ImageError("Invalid image path".into()))?;

    let filename = original_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image");

    let tmp_path = parent.join(format!("{}.__crop_tmp__", filename));

    // 画像フォーマットの判定と保存
    let format = ImageFormat::from_path(&original_path)
        .unwrap_or(ImageFormat::Png);

    cropped
        .save_with_format(&tmp_path, format)
        .map_err(|e| AppError::ImageError(format!("Failed to save cropped image: {}", e)))?;

    // 置換処理
    if let Err(_e) = fs::rename(&tmp_path, &original_path) {
        // renameが異なるドライブ等で失敗した場合はcopy&remove
        if let Err(copy_err) = fs::copy(&tmp_path, &original_path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(AppError::ImageError(format!("Failed to replace original image: {}", copy_err)));
        }
        let _ = fs::remove_file(&tmp_path);
    }

    Ok(CropImageResult {
        path: req.path,
        backup_available: backup_mgr.has_backup(&original_path),
        width: crop_w,
        height: crop_h,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};
    use tempfile::tempdir;

    #[test]
    fn crops_image_and_restores_its_first_backup() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("image.png");
        let image = RgbaImage::from_pixel(100, 80, Rgba([20, 40, 60, 255]));
        image.save(&path).unwrap();
        let manager = BackupManager::new().unwrap();
        let result = crop_image(CropImageRequest { path: path.to_string_lossy().into_owned(), x: 10, y: 20, width: 50, height: 30 }, &manager).unwrap();
        assert_eq!((result.width, result.height), (50, 30));
        assert!(result.backup_available);
        assert_eq!(image::image_dimensions(&path).unwrap(), (50, 30));
        assert!(manager.restore(&path).unwrap());
        assert_eq!(image::image_dimensions(&path).unwrap(), (100, 80));
    }

    #[test]
    fn invalid_image_does_not_overwrite_the_original() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("broken.png");
        let original = b"not an image";
        fs::write(&path, original).unwrap();
        let manager = BackupManager::new().unwrap();
        assert!(crop_image(CropImageRequest { path: path.to_string_lossy().into_owned(), x: 0, y: 0, width: 1, height: 1 }, &manager).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        assert!(manager.has_backup(&path));
    }
}
