//! OSクリップボードへのファイル・ビットマップ出力。
use serde::Deserialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static CLIPBOARD_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MermaidFileCopyRequest {
    pub kind: String,
    pub diagram_kind: String,
    pub source: String,
    pub svg: String,
    pub png_bytes: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFileCopyRequest {
    pub filename: String,
    pub content: String,
    #[serde(default)]
    pub utf8_bom: bool,
}

fn text_clipboard_file(request: TextFileCopyRequest) -> Result<(String, String, Vec<u8>), String> {
    let filename = request.filename.trim();
    if filename.is_empty()
        || filename.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        || filename == "."
        || filename == ".."
    {
        return Err("ファイル名に使用できない文字が含まれています。".into());
    }
    let path = Path::new(filename);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 16
                && value
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
        })
        .ok_or_else(|| "コピーするファイルの拡張子が不正です。".to_string())?
        .to_ascii_lowercase();
    let prefix = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file")
        .chars()
        .filter(|character| character.is_alphanumeric() || matches!(character, '-' | '_'))
        .take(48)
        .collect::<String>();
    let prefix = if prefix.is_empty() {
        "file".to_string()
    } else {
        prefix
    };
    let mut bytes =
        Vec::with_capacity(request.content.len() + if request.utf8_bom { 3 } else { 0 });
    if request.utf8_bom {
        bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
    }
    bytes.extend_from_slice(request.content.as_bytes());
    Ok((prefix, extension, bytes))
}

fn mermaid_clipboard_file(
    request: MermaidFileCopyRequest,
) -> Result<(String, String, Vec<u8>), String> {
    let (prefix, code_extension) = match request.diagram_kind.as_str() {
        "mermaid" => ("mermaid", "mmd"),
        "drawio" => ("drawio", "drawio"),
        _ => return Err("未対応の図表ファイル種別です。".into()),
    };
    match request.kind.as_str() {
        "code" => Ok((
            prefix.into(),
            code_extension.into(),
            request.source.into_bytes(),
        )),
        "svg" => Ok((prefix.into(), "svg".into(), request.svg.into_bytes())),
        "png" if !request.png_bytes.is_empty() => {
            Ok((prefix.into(), "png".into(), request.png_bytes))
        }
        "png" => Err("PNGデータが空です。".into()),
        "bmp" if !request.png_bytes.is_empty() => {
            Ok((prefix.into(), "bmp".into(), request.png_bytes))
        }
        "bmp" => Err("BMPデータが空です。".into()),
        _ => Err("未対応のMermaidコピー形式です。".into()),
    }
}

fn write_mermaid_clipboard_file(
    prefix: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let directory = std::env::temp_dir().join("mdvisualizer").join("clipboard");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("一時フォルダを作成できません: {error}"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    for _ in 0..16 {
        let sequence = CLIPBOARD_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = directory.join(format!("{prefix}-{timestamp}-{sequence}.{extension}"));
        match std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
        {
            Ok(mut file) => {
                file.write_all(bytes)
                    .map_err(|error| format!("一時ファイルを書き込めません: {error}"))?;
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("一時ファイルを作成できません: {error}")),
        }
    }
    Err("一時ファイル名を確保できません。".into())
}

#[cfg(target_os = "windows")]
fn copy_file_to_clipboard(path: &Path) -> Result<(), String> {
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    use windows_sys::Win32::Foundation::{GlobalFree, BOOL, POINT};
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows_sys::Win32::System::Ole::CF_HDROP;
    use windows_sys::Win32::UI::Shell::DROPFILES;

    let mut wide = path.as_os_str().encode_wide().collect::<Vec<u16>>();
    wide.extend([0, 0]);
    let byte_len = size_of::<DROPFILES>() + std::mem::size_of_val(wide.as_slice());
    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE, byte_len);
        if memory.is_null() {
            return Err("クリップボード用メモリを確保できません。".into());
        }
        let data = GlobalLock(memory);
        if data.is_null() {
            GlobalFree(memory);
            return Err("クリップボード用メモリをロックできません。".into());
        }
        ptr::write(
            data.cast::<DROPFILES>(),
            DROPFILES {
                pFiles: size_of::<DROPFILES>() as u32,
                pt: POINT { x: 0, y: 0 },
                fNC: 0 as BOOL,
                fWide: 1 as BOOL,
            },
        );
        ptr::copy_nonoverlapping(
            wide.as_ptr().cast::<u8>(),
            data.cast::<u8>().add(size_of::<DROPFILES>()),
            std::mem::size_of_val(wide.as_slice()),
        );
        GlobalUnlock(memory);
        if OpenClipboard(ptr::null_mut()) == 0 {
            GlobalFree(memory);
            return Err("クリップボードを開けません。".into());
        }
        if EmptyClipboard() == 0 {
            CloseClipboard();
            GlobalFree(memory);
            return Err("クリップボードを空にできません。".into());
        }
        if SetClipboardData(CF_HDROP as u32, memory).is_null() {
            CloseClipboard();
            GlobalFree(memory);
            return Err("ファイルをクリップボードへ設定できません。".into());
        }
        CloseClipboard();
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn copy_bmp_bytes_to_clipboard(bytes: &[u8]) -> Result<(), String> {
    use std::ptr;
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows_sys::Win32::System::Ole::CF_DIB;

    // CF_DIB expects the BMP payload without BITMAPFILEHEADER (14 bytes).
    if bytes.len() < 54 || &bytes[..2] != b"BM" {
        return Err("BMPデータが不正です。".into());
    }
    let dib = &bytes[14..];
    let memory = unsafe { GlobalAlloc(GMEM_MOVEABLE, dib.len()) };
    if memory.is_null() {
        return Err("クリップボード用メモリを確保できません。".into());
    }
    let data = unsafe { GlobalLock(memory) };
    if data.is_null() {
        unsafe { GlobalFree(memory) };
        return Err("クリップボード用メモリをロックできません。".into());
    }
    unsafe {
        ptr::copy_nonoverlapping(dib.as_ptr(), data.cast::<u8>(), dib.len());
        GlobalUnlock(memory);
        if OpenClipboard(ptr::null_mut()) == 0 {
            GlobalFree(memory);
            return Err("クリップボードを開けません。".into());
        }
        if EmptyClipboard() == 0 {
            CloseClipboard();
            GlobalFree(memory);
            return Err("クリップボードを空にできません。".into());
        }
        if SetClipboardData(CF_DIB as u32, memory).is_null() {
            CloseClipboard();
            GlobalFree(memory);
            return Err("BMPをクリップボードへ設定できません。".into());
        }
        CloseClipboard();
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn copy_bmp_bytes_to_clipboard(_bytes: &[u8]) -> Result<(), String> {
    Err("BMP画像のコピーはWindowsでのみ利用できます。".into())
}

#[tauri::command]
pub fn copy_bmp_to_clipboard(bytes: Vec<u8>) -> Result<(), String> {
    copy_bmp_bytes_to_clipboard(&bytes)
}

#[cfg(not(target_os = "windows"))]
fn copy_file_to_clipboard(_path: &Path) -> Result<(), String> {
    Err("ファイルとしてコピーはWindowsでのみ利用できます。".into())
}

#[tauri::command]
pub fn copy_mermaid_file(request: MermaidFileCopyRequest) -> Result<String, String> {
    let (prefix, extension, bytes) = mermaid_clipboard_file(request)?;
    let path = write_mermaid_clipboard_file(&prefix, &extension, &bytes)?;
    if let Err(error) = copy_file_to_clipboard(&path) {
        let _ = std::fs::remove_file(&path);
        return Err(error);
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn copy_text_file(request: TextFileCopyRequest) -> Result<String, String> {
    let (prefix, extension, bytes) = text_clipboard_file(request)?;
    let path = write_mermaid_clipboard_file(&prefix, &extension, &bytes)?;
    if let Err(error) = copy_file_to_clipboard(&path) {
        let _ = std::fs::remove_file(&path);
        return Err(error);
    }
    Ok(path.to_string_lossy().into_owned())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepares_expected_file_contents_for_each_mermaid_copy_kind() {
        let request = || MermaidFileCopyRequest {
            kind: "code".into(),
            diagram_kind: "mermaid".into(),
            source: "flowchart LR".into(),
            svg: "<svg/>".into(),
            png_bytes: vec![137, 80, 78, 71],
        };
        assert_eq!(
            mermaid_clipboard_file(request()).unwrap(),
            ("mermaid".into(), "mmd".into(), b"flowchart LR".to_vec())
        );
        let mut svg = request();
        svg.kind = "svg".into();
        assert_eq!(
            mermaid_clipboard_file(svg).unwrap(),
            ("mermaid".into(), "svg".into(), b"<svg/>".to_vec())
        );
        let mut png = request();
        png.kind = "png".into();
        assert_eq!(
            mermaid_clipboard_file(png).unwrap(),
            ("mermaid".into(), "png".into(), vec![137, 80, 78, 71])
        );
        let mut bmp = request();
        bmp.kind = "bmp".into();
        bmp.png_bytes = vec![0x42, 0x4d, 0, 0];
        assert_eq!(
            mermaid_clipboard_file(bmp).unwrap(),
            ("mermaid".into(), "bmp".into(), vec![0x42, 0x4d, 0, 0])
        );

        let mut drawio = request();
        drawio.diagram_kind = "drawio".into();
        drawio.source = "<mxfile/>".into();
        assert_eq!(
            mermaid_clipboard_file(drawio).unwrap(),
            ("drawio".into(), "drawio".into(), b"<mxfile/>".to_vec())
        );
    }

    #[test]
    fn rejects_invalid_bmp_before_touching_the_clipboard() {
        assert!(copy_bmp_bytes_to_clipboard(&[]).is_err());
        assert!(copy_bmp_bytes_to_clipboard(b"not-a-bmp").is_err());
    }

    #[test]
    fn prepares_validated_text_clipboard_files_with_optional_utf8_bom() {
        assert_eq!(
            text_clipboard_file(TextFileCopyRequest {
                filename: "table.csv".into(),
                content: "a,b\n1,2".into(),
                utf8_bom: true,
            })
            .unwrap(),
            (
                "table".into(),
                "csv".into(),
                [vec![0xef, 0xbb, 0xbf], b"a,b\n1,2".to_vec()].concat()
            ),
        );
        assert!(text_clipboard_file(TextFileCopyRequest {
            filename: "../escape.txt".into(),
            content: "x".into(),
            utf8_bom: false,
        })
        .is_err());
        assert!(text_clipboard_file(TextFileCopyRequest {
            filename: "no-extension".into(),
            content: "x".into(),
            utf8_bom: false,
        })
        .is_err());
    }

}
