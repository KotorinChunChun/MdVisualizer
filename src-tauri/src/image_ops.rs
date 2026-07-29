use crate::backup::BackupManager;
use crate::errors::{AppError, AppResult};
use crate::file_lock::{atomic_replace, with_lock_timeout};
use image::{imageops, GenericImageView, ImageFormat, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CropImageRequest {
    pub path: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub padding_mode: Option<PaddingMode>,
    /// Dimensions recorded when the crop overlay opened. They are optional for
    /// backwards compatibility, but when supplied they prevent a stale crop
    /// from overwriting an image changed by another process.
    pub expected_source_width: Option<u32>,
    pub expected_source_height: Option<u32>,
}

#[derive(Clone, Copy, Deserialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum PaddingMode {
    Auto,
    Transparent,
    White,
    Black,
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

    // This is an OS-level per-image lock, so it serializes independent app
    // processes without holding any application Mutex while image I/O runs.
    with_lock_timeout(&original_path, Duration::from_secs(10), || {
        let img = image::open(&original_path)
            .map_err(|e| AppError::ImageError(format!("Failed to open image: {e}")))?;
        let (orig_w, orig_h) = img.dimensions();

        if req
            .expected_source_width
            .is_some_and(|width| width != orig_w)
            || req
                .expected_source_height
                .is_some_and(|height| height != orig_h)
        {
            return Err(AppError::ImageError(
                "Image changed since the crop selection was opened; reload it before cropping again.".into(),
            ));
        }

        let output_w = req.width.max(1);
        let output_h = req.height.max(1);
        let request_right = i64::from(req.x) + i64::from(output_w);
        let request_bottom = i64::from(req.y) + i64::from(output_h);
        let source_x = req.x.max(0) as u32;
        let source_y = req.y.max(0) as u32;
        let source_right = request_right.min(i64::from(orig_w)).max(i64::from(source_x)) as u32;
        let source_bottom = request_bottom.min(i64::from(orig_h)).max(i64::from(source_y)) as u32;
        if source_right <= source_x || source_bottom <= source_y {
            return Err(AppError::ImageError(
                "The crop selection must overlap the source image.".into(),
            ));
        }

        let format = ImageFormat::from_path(&original_path).unwrap_or(ImageFormat::Png);
        let padding_mode = req.padding_mode.unwrap_or(PaddingMode::Auto);
        if matches!(padding_mode, PaddingMode::Transparent) && !format_supports_alpha(format) {
            return Err(AppError::ImageError(
                "Transparent padding is not available for this image format.".into(),
            ));
        }
        let source_rgba = img.to_rgba8();
        let background = match padding_mode {
            PaddingMode::Auto => average_perimeter_color(&source_rgba),
            PaddingMode::Transparent => Rgba([0, 0, 0, 0]),
            PaddingMode::White => Rgba([255, 255, 255, 255]),
            PaddingMode::Black => Rgba([0, 0, 0, 255]),
        };
        let mut output = RgbaImage::from_pixel(output_w, output_h, background);
        let copied = imageops::crop_imm(
            &source_rgba,
            source_x,
            source_y,
            source_right - source_x,
            source_bottom - source_y,
        ).to_image();
        imageops::overlay(
            &mut output,
            &copied,
            i64::from(source_x) - i64::from(req.x),
            i64::from(source_y) - i64::from(req.y),
        );

        // The source is now validated. A backup is created only immediately
        // before a possible write, and never after another process changed it.
        backup_mgr.ensure_backup(&original_path)?;
        let tmp_path = unique_crop_temp_path(&original_path)?;
        let write_result = output
            .save_with_format(&tmp_path, format)
            .map_err(|e| AppError::ImageError(format!("Failed to save cropped image: {e}")));
        if let Err(error) = write_result {
            let _ = fs::remove_file(&tmp_path);
            return Err(error);
        }
        if let Err(error) = OpenOptions::new()
            .write(true)
            .open(&tmp_path)
            .and_then(|file| file.sync_all())
            .map_err(|e| AppError::ImageError(format!("Failed to sync cropped image: {e}")))
        {
            let _ = fs::remove_file(&tmp_path);
            return Err(error);
        }
        atomic_replace(&tmp_path, &original_path)
            .map_err(|e| AppError::ImageError(format!("Failed to replace original image: {e}")))?;

        Ok(CropImageResult {
            path: req.path.clone(),
            backup_available: backup_mgr.has_backup(&original_path),
            width: output_w,
            height: output_h,
        })
    })
}

fn format_supports_alpha(format: ImageFormat) -> bool {
    matches!(
        format,
        ImageFormat::Png
            | ImageFormat::WebP
            | ImageFormat::Gif
            | ImageFormat::Tiff
            | ImageFormat::Tga
            | ImageFormat::Avif
    )
}

fn average_perimeter_color(image: &RgbaImage) -> Rgba<u8> {
    let (width, height) = image.dimensions();
    let mut buckets = vec![[0_u64; 4]; 16 * 16 * 16];
    let mut sample = |pixel: &Rgba<u8>| {
        let index = (usize::from(pixel[0] >> 4) << 8)
            | (usize::from(pixel[1] >> 4) << 4)
            | usize::from(pixel[2] >> 4);
        buckets[index][0] += 1;
        buckets[index][1] += u64::from(pixel[0]);
        buckets[index][2] += u64::from(pixel[1]);
        buckets[index][3] += u64::from(pixel[2]);
    };
    for x in 0..width {
        sample(image.get_pixel(x, 0));
        if height > 1 {
            sample(image.get_pixel(x, height - 1));
        }
    }
    for y in 1..height.saturating_sub(1) {
        sample(image.get_pixel(0, y));
        if width > 1 {
            sample(image.get_pixel(width - 1, y));
        }
    }
    let dominant = buckets.into_iter().max_by_key(|bucket| bucket[0]).unwrap_or([1, 0, 0, 0]);
    let count = dominant[0].max(1);
    Rgba([(dominant[1] / count) as u8, (dominant[2] / count) as u8, (dominant[3] / count) as u8, 255])
}

fn unique_crop_temp_path(original_path: &Path) -> AppResult<PathBuf> {
    let parent = original_path
        .parent()
        .ok_or_else(|| AppError::ImageError("Invalid image path".into()))?;
    let filename = original_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image");
    for sequence in 0..32_u32 {
        let candidate = parent.join(format!(
            ".{filename}.crop-{}-{}-{sequence}.tmp",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(_) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(AppError::ImageError(format!(
                    "Failed to create crop temp file: {error}"
                )))
            }
        }
    }
    Err(AppError::ImageError(
        "Failed to allocate a unique crop temp file.".into(),
    ))
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
        let result = crop_image(
            CropImageRequest {
                path: path.to_string_lossy().into_owned(),
                x: 10,
                y: 20,
                width: 50,
                height: 30,
                padding_mode: None,
                expected_source_width: Some(100),
                expected_source_height: Some(80),
            },
            &manager,
        )
        .unwrap();
        assert_eq!((result.width, result.height), (50, 30));
        assert!(result.backup_available);
        assert_eq!(image::image_dimensions(&path).unwrap(), (50, 30));
        assert!(manager.restore(&path).unwrap());
        assert_eq!(image::image_dimensions(&path).unwrap(), (100, 80));
    }

    #[test]
    fn adds_transparent_padding_outside_a_png() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("padded.png");
        RgbaImage::from_pixel(4, 3, Rgba([20, 40, 60, 255]))
            .save(&path)
            .unwrap();
        let manager = BackupManager::new().unwrap();
        let result = crop_image(
            CropImageRequest {
                path: path.to_string_lossy().into_owned(),
                x: -1,
                y: -2,
                width: 7,
                height: 6,
                padding_mode: Some(PaddingMode::Transparent),
                expected_source_width: Some(4),
                expected_source_height: Some(3),
            },
            &manager,
        )
        .unwrap();

        assert_eq!((result.width, result.height), (7, 6));
        let output = image::open(path).unwrap().to_rgba8();
        assert_eq!(output.get_pixel(0, 0), &Rgba([0, 0, 0, 0]));
        assert_eq!(output.get_pixel(1, 2), &Rgba([20, 40, 60, 255]));
    }

    #[test]
    fn auto_padding_uses_the_average_perimeter_color() {
        let mut source = RgbaImage::from_pixel(3, 3, Rgba([10, 20, 30, 255]));
        source.put_pixel(1, 1, Rgba([250, 240, 230, 255]));
        source.put_pixel(0, 0, Rgba([240, 230, 220, 255]));
        assert_eq!(average_perimeter_color(&source), Rgba([10, 20, 30, 255]));
    }

    #[test]
    fn invalid_image_does_not_overwrite_the_original() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("broken.png");
        let original = b"not an image";
        fs::write(&path, original).unwrap();
        let manager = BackupManager::new().unwrap();
        assert!(crop_image(
            CropImageRequest {
                path: path.to_string_lossy().into_owned(),
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                padding_mode: None,
                expected_source_width: None,
                expected_source_height: None
            },
            &manager
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        assert!(!manager.has_backup(&path));
    }

    #[test]
    fn stale_dimensions_fail_without_overwriting_the_image() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("image.png");
        RgbaImage::from_pixel(50, 40, Rgba([1, 2, 3, 255]))
            .save(&path)
            .unwrap();
        let manager = BackupManager::new().unwrap();
        let result = crop_image(
            CropImageRequest {
                path: path.to_string_lossy().into_owned(),
                x: 0,
                y: 0,
                width: 20,
                height: 20,
                padding_mode: None,
                expected_source_width: Some(100),
                expected_source_height: Some(80),
            },
            &manager,
        );
        assert!(
            matches!(result, Err(AppError::ImageError(message)) if message.contains("changed since"))
        );
        assert_eq!(image::image_dimensions(&path).unwrap(), (50, 40));
        assert!(!manager.has_backup(&path));
    }

    #[test]
    fn concurrent_crops_allow_only_the_first_matching_source_dimensions() {
        use std::sync::{Arc, Barrier};
        use std::thread;

        let dir = tempdir().unwrap();
        let path = dir.path().join("shared.png");
        RgbaImage::from_pixel(100, 80, Rgba([20, 40, 60, 255]))
            .save(&path)
            .unwrap();
        let path = Arc::new(path);
        let barrier = Arc::new(Barrier::new(2));
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let path = Arc::clone(&path);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    let manager = BackupManager::new().unwrap();
                    barrier.wait();
                    crop_image(
                        CropImageRequest {
                            path: path.to_string_lossy().into_owned(),
                            x: 0,
                            y: 0,
                            width: 50,
                            height: 30,
                            padding_mode: None,
                            expected_source_width: Some(100),
                            expected_source_height: Some(80),
                        },
                        &manager,
                    )
                })
            })
            .collect();
        let results: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert!(results.iter().any(|result| matches!(result, Err(AppError::ImageError(message)) if message.contains("changed since"))));
        assert_eq!(image::image_dimensions(&*path).unwrap(), (50, 30));
        assert!(!fs::read_dir(dir.path()).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains(".crop-")));
    }
}
