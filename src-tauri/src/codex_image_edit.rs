//! PNG編集専用のCodex CLI経路。生成物はCodexの画像出力フォルダーだけから回収する。
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs::OpenOptions,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, State, WebviewWindow};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
};

const IMAGE_LIMIT: usize = 10 * 1024 * 1024;
const OUTPUT_LIMIT: usize = 2_000_000;

#[derive(Default)]
pub struct CodexImageRuns(Mutex<HashMap<String, (String, Arc<AtomicBool>)>>);
impl CodexImageRuns {
    fn begin(&self, owner: &str, id: &str) -> Result<Arc<AtomicBool>, String> {
        let mut runs = self
            .0
            .lock()
            .map_err(|_| "画像編集の実行状態を取得できません。")?;
        if runs.contains_key(owner) {
            return Err("前の画像編集が終了するまでお待ちください。".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        runs.insert(owner.into(), (id.into(), cancel.clone()));
        Ok(cancel)
    }
    fn finish(&self, owner: &str) {
        if let Ok(mut runs) = self.0.lock() {
            runs.remove(owner);
        }
    }
    pub fn close_window(&self, owner: &str) {
        if let Ok(runs) = self.0.lock() {
            if let Some((_, cancel)) = runs.get(owner) {
                cancel.store(true, Ordering::SeqCst);
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexImageEditRequest {
    pub id: String,
    pub instruction: String,
    pub document_path: String,
    pub source: String,
    pub image: CodexImageInput,
}
#[derive(Deserialize)]
pub struct CodexImageInput {
    pub base64: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexImageEditReply {
    pub base64: String,
    pub media_type: &'static str,
    pub filename: String,
}

#[derive(Default)]
pub struct CodexImageSaveRollbacks(Mutex<HashMap<String, ImageRollback>>);
struct ImageRollback {
    owner: String,
    written: PathBuf,
    result: Vec<u8>,
    previous: Option<Vec<u8>>,
    created: bool,
    archive: Option<PathBuf>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexImageSaveRequest {
    pub document_path: String,
    pub source: String,
    pub expected_original_base64: String,
    pub result_base64: String,
    pub mode: String,
    pub filename: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexImageSaveReply {
    pub new_source: String,
    pub rollback_id: String,
}

fn decode_png(input: &CodexImageInput) -> Result<Vec<u8>, String> {
    if input.base64.len() > IMAGE_LIMIT.div_ceil(3) * 4 {
        return Err("画像は10MB以下にしてください。".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&input.base64)
        .map_err(|_| "画像データが不正です。")?;
    if bytes.len() > IMAGE_LIMIT
        || image::guess_format(&bytes).ok() != Some(image::ImageFormat::Png)
    {
        return Err("PNG画像を選択してください。".into());
    }
    validate_png(&bytes)?;
    Ok(bytes)
}
fn validate_png(bytes: &[u8]) -> Result<(), String> {
    let reader =
        image::ImageReader::with_format(std::io::Cursor::new(bytes), image::ImageFormat::Png);
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| "画像が破損しています。")?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 40_000_000 {
        return Err("画像は4,000万画素以下にしてください。".into());
    }
    Ok(())
}
fn local_asset(document_path: &str, source: &str) -> Result<(PathBuf, PathBuf, String), String> {
    if source.contains("://") || source.to_ascii_lowercase().starts_with("data:") {
        return Err("ローカルPNG画像を選択してください。".into());
    }
    let document = PathBuf::from(document_path)
        .canonicalize()
        .map_err(|_| "Markdown文書を確認できません。")?;
    let parent = document
        .parent()
        .ok_or("Markdown文書のフォルダーを確認できません。")?
        .to_path_buf();
    let relative = Path::new(source.split(['?', '#']).next().unwrap_or(source));
    if relative.is_absolute()
        || relative.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("画像参照はMarkdownフォルダー内にしてください。".into());
    }
    let path = parent
        .join(relative)
        .canonicalize()
        .map_err(|_| "元画像を確認できません。")?;
    if !path.starts_with(&parent) {
        return Err("画像参照はMarkdownフォルダー外を指しています。".into());
    }
    Ok((parent, path, relative.to_string_lossy().replace('\\', "/")))
}
fn safe_filename(filename: &str) -> Result<&str, String> {
    let stem = filename.strip_suffix(".png").unwrap_or("");
    let device_name = stem.split('.').next().unwrap_or("").to_ascii_lowercase();
    let reserved = matches!(device_name.as_str(), "con" | "prn" | "aux" | "nul")
        || ["com", "lpt"].iter().any(|prefix| {
            device_name.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
        });
    let unsafe_char = |ch: char| {
        ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
    };
    if filename.len() > 240
        || stem.is_empty()
        || stem.ends_with([' ', '.'])
        || reserved
        || filename.chars().any(unsafe_char)
    {
        Err("保存するPNGファイル名を確認してください。".into())
    } else {
        Ok(filename)
    }
}

fn archive_path(dir: &Path, original: &Path) -> Result<PathBuf, String> {
    let filename = original.file_name().ok_or("元画像名を確認できません。")?;
    let first = dir.join(filename);
    if !first.exists() {
        return Ok(first);
    }
    let stem = original
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or("元画像名を確認できません。")?;
    let extension = original
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");
    for index in 1..10_000 {
        let candidate = dir.join(format!("{stem} ({index}).{extension}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("archive内に保存できる画像名がありません。".into())
}
async fn bounded_read(reader: impl AsyncRead + Unpin) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take((OUTPUT_LIMIT + 1) as u64)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| "AI出力を読み込めません。")?;
    if bytes.len() > OUTPUT_LIMIT {
        return Err("AI出力が大きすぎます。".into());
    }
    Ok(bytes)
}
fn generated_root() -> Result<PathBuf, String> {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|path| path.join(".codex")))
        .map(|path| path.join("generated_images"))
        .and_then(|p| p.canonicalize().ok())
        .ok_or_else(|| "AI画像出力フォルダーを確認できません。".into())
}
fn strings(value: &Value, found: &mut Vec<String>) {
    match value {
        Value::String(s) => found.push(s.clone()),
        Value::Array(v) => v.iter().for_each(|x| strings(x, found)),
        Value::Object(v) => v.values().for_each(|x| strings(x, found)),
        _ => {}
    }
}
fn output_png(stdout: &[u8], root: &Path, started: SystemTime) -> Result<Vec<u8>, String> {
    let text = std::str::from_utf8(stdout).map_err(|_| "AI出力の文字コードが不正です。")?;
    let mut candidates = Vec::new();
    for line in text.lines() {
        let Ok(event) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if event.get("type").and_then(Value::as_str) != Some("item.completed") {
            continue;
        }
        strings(&event, &mut candidates);
    }
    for candidate in candidates {
        if !candidate.to_ascii_lowercase().ends_with(".png") {
            continue;
        }
        let Ok(path) = PathBuf::from(candidate).canonicalize() else {
            continue;
        };
        if !path.starts_with(root)
            || path
                .extension()
                .and_then(|v| v.to_str())
                .is_none_or(|v| !v.eq_ignore_ascii_case("png"))
        {
            continue;
        }
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        if metadata.len() == 0
            || metadata.len() > IMAGE_LIMIT as u64
            || metadata
                .modified()
                .ok()
                .is_none_or(|time| time + Duration::from_secs(5) < started)
        {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        if validate_png(&bytes).is_ok() {
            return Ok(bytes);
        }
    }
    Err("AIが新しいPNG画像を返しませんでした。".into())
}

#[tauri::command]
pub async fn codex_edit_image(
    app: AppHandle,
    window: WebviewWindow,
    runs: State<'_, CodexImageRuns>,
    request: CodexImageEditRequest,
) -> Result<CodexImageEditReply, String> {
    if request.id.is_empty()
        || request.instruction.trim().is_empty()
        || request.instruction.len() > 20_000
    {
        return Err("画像編集の指示を確認してください。".into());
    }
    let settings = crate::commands::load_settings(app)?;
    if settings["codex"]["enabled"] != true {
        return Err("設定でAI連携を有効にしてください。".into());
    }
    let image = decode_png(&request.image)?;
    let started = SystemTime::now();
    let owner = window.label().to_owned();
    let cancel = runs.begin(&owner, &request.id)?;
    let result = async {
        let workspace = tempfile::tempdir().map_err(|_| "一時領域を作成できません。")?; let input = workspace.path().join("input.png"); std::fs::write(&input, image).map_err(|_| "入力画像を準備できません。")?;
        let prompt = format!("Edit the supplied PNG exactly as requested. Create one PNG output using image generation. Do not read files other than the supplied image. In your final response, provide only the absolute path to the generated PNG.\n{}", request.instruction);
        let exe = crate::codex::find_codex_executable()?; let model = settings["codex"]["model"].as_str().unwrap_or("gpt-5.6-luna"); let mut command = Command::new(exe);
        command.current_dir(workspace.path()).args(["exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "-s", "workspace-write", "--enable", "image_generation", "--enable", "code_mode_host", "-m", model, "--json", "--image"]).arg(&input);
        for feature in ["shell_tool", "unified_exec", "apps", "plugins", "hooks", "multi_agent"] { command.args(["--disable", feature]); }
        command.arg("-").stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
        #[cfg(windows)] command.creation_flags(0x08000000);
        let mut child = command.spawn().map_err(|_| "AI連携用のCodex CLIを起動できません。")?; let mut stdin = child.stdin.take().ok_or("CLI入力を取得できません。")?; let stdout = child.stdout.take().ok_or("CLI出力を取得できません。")?; let stderr = child.stderr.take().ok_or("CLIエラー出力を取得できません。")?;
        let execution = async { stdin.write_all(prompt.as_bytes()).await.map_err(|_| "CLIへ送信できません。".to_string())?; drop(stdin); let (out, _, status) = tokio::try_join!(bounded_read(stdout), bounded_read(stderr), async { child.wait().await.map_err(|_| "CLIの終了待機に失敗しました。".to_string()) })?; if !status.success() { return Err("AIによる画像編集に失敗しました。".into()); } output_png(&out, &generated_root()?, started) };
        tokio::select! { result = execution => result, _ = async { while !cancel.load(Ordering::SeqCst) { tokio::time::sleep(Duration::from_millis(50)).await; } } => Err("停止しました。".into()), _ = tokio::time::sleep(Duration::from_secs(300)) => Err("画像編集がタイムアウトしました。".into()) }
    }.await;
    runs.finish(&owner);
    let bytes = result?;
    Ok(CodexImageEditReply {
        filename: "codex-edited.png".into(),
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        media_type: "image/png",
    })
}
#[tauri::command]
pub fn codex_cancel_image(
    window: WebviewWindow,
    runs: State<'_, CodexImageRuns>,
    id: String,
) -> Result<(), String> {
    if let Ok(runs) = runs.0.lock() {
        if let Some((active, cancel)) = runs.get(window.label()) {
            if active == &id {
                cancel.store(true, Ordering::SeqCst);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn codex_save_edited_image(
    window: WebviewWindow,
    rollbacks: State<'_, CodexImageSaveRollbacks>,
    request: CodexImageSaveRequest,
) -> Result<CodexImageSaveReply, String> {
    let mut entries = rollbacks
        .0
        .lock()
        .map_err(|_| "画像保存状態を取得できません。")?;
    save_edited_image(&request, window.label(), &mut entries)
}
fn save_edited_image(
    request: &CodexImageSaveRequest,
    owner: &str,
    rollbacks: &mut HashMap<String, ImageRollback>,
) -> Result<CodexImageSaveReply, String> {
    let result = decode_png(&CodexImageInput {
        base64: request.result_base64.clone(),
    })?;
    let expected = base64::engine::general_purpose::STANDARD
        .decode(&request.expected_original_base64)
        .map_err(|_| "元画像の確認情報が不正です。")?;
    let (parent, original, source) = local_asset(&request.document_path, &request.source)?;
    let actual = std::fs::read(&original).map_err(|_| "元画像を読み込めません。")?;
    if actual != expected {
        return Err("元画像が外部で変更されました。最新の画像でやり直してください。".into());
    }
    let (written, new_source, archive, reserve_new) = match request.mode.as_str() {
        "overwrite" => (original.clone(), source, None, false),
        "new" => {
            let filename = safe_filename(&request.filename)?;
            (parent.join(filename), filename.into(), None, true)
        }
        "archive" => {
            let archive_dir = original
                .parent()
                .ok_or("元画像フォルダーを確認できません。")?
                .join("archive");
            (
                original.clone(),
                source,
                Some((archive_dir, PathBuf::new())),
                false,
            )
        }
        _ => return Err("画像の採用方法を確認してください。".into()),
    };
    if rollbacks.values().any(|entry| entry.written == written) {
        return Err("この画像は別の採用処理で使用中です。".into());
    }
    let archive = if let Some((dir, _)) = archive {
        std::fs::create_dir_all(&dir).map_err(|_| "archiveフォルダーを作成できません。")?;
        let canonical_dir = dir
            .canonicalize()
            .map_err(|_| "archiveフォルダーを確認できません。")?;
        if !canonical_dir.starts_with(&parent) {
            return Err("archiveはMarkdown文書フォルダー内にしてください。".into());
        }
        let backup = archive_path(&canonical_dir, &original)?;
        use std::io::Write;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&backup)
            .map_err(|_| "archive画像が既に存在するか保存できません。")?;
        if file
            .write_all(&actual)
            .and_then(|_| file.sync_all())
            .is_err()
        {
            drop(file);
            let _ = std::fs::remove_file(&backup);
            return Err("元画像をarchiveへ保存できません。".into());
        }
        Some(backup)
    } else {
        None
    };
    if reserve_new
        && OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&written)
            .is_err()
    {
        return Err("新しい画像名が既に使われています。".into());
    }
    let previous = if reserve_new { None } else { Some(actual) };
    if crate::file_lock::atomic_write(&written, &result).is_err() {
        if reserve_new {
            let _ = std::fs::remove_file(&written);
        }
        if let Some(backup) = &archive {
            let _ = std::fs::remove_file(backup);
        }
        return Err("編集画像を置換できません。".into());
    }
    let id = crypto_token();
    rollbacks.insert(
        id.clone(),
        ImageRollback {
            owner: owner.into(),
            written,
            result,
            previous,
            created: reserve_new,
            archive,
        },
    );
    Ok(CodexImageSaveReply {
        new_source,
        rollback_id: id,
    })
}
fn crypto_token() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    )
}
#[tauri::command]
pub fn codex_finalize_edited_image(
    window: WebviewWindow,
    rollbacks: State<'_, CodexImageSaveRollbacks>,
    rollback_id: String,
    commit: bool,
) -> Result<(), String> {
    let mut entries = rollbacks
        .0
        .lock()
        .map_err(|_| "画像保存状態を取得できません。")?;
    finalize_edited_image(window.label(), &rollback_id, commit, &mut *entries)
}
fn finalize_edited_image(
    owner: &str,
    rollback_id: &str,
    commit: bool,
    rollbacks: &mut HashMap<String, ImageRollback>,
) -> Result<(), String> {
    let entry = rollbacks
        .get(rollback_id)
        .ok_or("画像保存の確認情報が見つかりません。")?;
    if entry.owner != owner {
        return Err("別ウィンドウの画像保存は確定できません。".into());
    }
    if commit {
        rollbacks.remove(rollback_id);
        return Ok(());
    }
    if std::fs::read(&entry.written).ok().as_deref() != Some(entry.result.as_slice()) {
        return Err(
            "保存後に画像が外部で変更されました。外部の変更を保護するため自動復旧を中止しました。"
                .into(),
        );
    }
    if let Some(previous) = &entry.previous {
        crate::file_lock::atomic_write(&entry.written, previous)
            .map_err(|_| "元画像を復旧できません。")?;
    } else if entry.created {
        std::fs::remove_file(&entry.written).map_err(|_| "生成画像を取り消せません。")?;
    }
    if let Some(archive) = &entry.archive {
        if archive.exists() && std::fs::read(archive).ok() == entry.previous {
            std::fs::remove_file(archive).map_err(|_| "archive画像を復旧できません。")?;
        }
    }
    rollbacks.remove(rollback_id);
    Ok(())
}

impl CodexImageSaveRollbacks {
    pub fn close_window(&self, owner: &str) -> Result<(), String> {
        let mut entries = self
            .0
            .lock()
            .map_err(|_| "画像保存状態を取得できません。")?;
        let ids: Vec<String> = entries
            .iter()
            .filter_map(|(id, entry)| (entry.owner == owner).then(|| id.clone()))
            .collect();
        let failures: Vec<String> = ids
            .iter()
            .filter_map(|id| finalize_edited_image(owner, id, false, &mut entries).err())
            .collect();
        if failures.is_empty() {
            Ok(())
        } else {
            Err(failures.join(" "))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn png() -> Vec<u8> {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(2, 2)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }
    #[test]
    fn accepts_only_new_png_under_generated_root_returned_by_event() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("new.png");
        std::fs::write(&path, png()).unwrap();
        let root = root.path().canonicalize().unwrap();
        let event = serde_json::json!({"type":"item.completed","item":{"type":"AgentMessage","content":[{"text":path.to_string_lossy()}]}}).to_string();
        assert_eq!(
            output_png(
                event.as_bytes(),
                &root,
                SystemTime::now() - Duration::from_secs(1)
            )
            .unwrap(),
            png()
        );
    }
    #[test]
    fn rejects_png_path_outside_generated_root() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new()
            .unwrap()
            .into_temp_path()
            .with_extension("png");
        std::fs::write(&outside, png()).unwrap();
        let event = serde_json::json!({"type":"item.completed","path":outside.to_string_lossy()})
            .to_string();
        assert!(output_png(
            event.as_bytes(),
            root.path(),
            SystemTime::now() - Duration::from_secs(1)
        )
        .is_err());
    }
    #[test]
    fn filename_rejects_windows_devices_and_path_escape() {
        for value in [
            "../x.png",
            "x:y.png",
            "con.png",
            "COM9.png",
            "lpt1.png",
            "LPT9.png",
            "photo.jpg",
            "name .png",
        ] {
            assert!(safe_filename(value).is_err(), "{value}");
        }
        assert_eq!(
            safe_filename("edited-image.png").unwrap(),
            "edited-image.png"
        );
        assert_eq!(
            safe_filename("編集後の画像.png").unwrap(),
            "編集後の画像.png"
        );
        assert_eq!(safe_filename("éé.png").unwrap(), "éé.png");
    }
    fn request(
        document: &Path,
        source: &str,
        expected: &[u8],
        result: &[u8],
        mode: &str,
        filename: &str,
    ) -> CodexImageSaveRequest {
        CodexImageSaveRequest {
            document_path: document.to_string_lossy().into(),
            source: source.into(),
            expected_original_base64: base64::engine::general_purpose::STANDARD.encode(expected),
            result_base64: base64::engine::general_purpose::STANDARD.encode(result),
            mode: mode.into(),
            filename: filename.into(),
        }
    }
    fn fixture() -> (tempfile::TempDir, PathBuf, Vec<u8>, Vec<u8>) {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("note.md");
        std::fs::write(&doc, "![](image.png)").unwrap();
        let before = png();
        let mut cursor = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(3, 2)
            .write_to(&mut cursor, image::ImageFormat::Png)
            .unwrap();
        let after = cursor.into_inner();
        std::fs::write(dir.path().join("image.png"), &before).unwrap();
        (dir, doc, before, after)
    }
    #[test]
    fn save_modes_keep_original_until_owner_finalizes_or_rolls_back() {
        let (dir, doc, before, after) = fixture();
        let mut rollbacks = HashMap::new();
        let overwrite = save_edited_image(
            &request(
                &doc,
                "image.png",
                &before,
                &after,
                "overwrite",
                "ignored.png",
            ),
            "w1",
            &mut rollbacks,
        )
        .unwrap();
        assert_eq!(std::fs::read(dir.path().join("image.png")).unwrap(), after);
        finalize_edited_image("w1", &overwrite.rollback_id, false, &mut rollbacks).unwrap();
        assert_eq!(std::fs::read(dir.path().join("image.png")).unwrap(), before);
        let new = save_edited_image(
            &request(&doc, "image.png", &before, &after, "new", "edited.png"),
            "w1",
            &mut rollbacks,
        )
        .unwrap();
        assert_eq!(new.new_source, "edited.png");
        assert!(dir.path().join("edited.png").exists());
        finalize_edited_image("w1", &new.rollback_id, false, &mut rollbacks).unwrap();
        assert!(!dir.path().join("edited.png").exists());
        let archive = save_edited_image(
            &request(&doc, "image.png", &before, &after, "archive", "ignored.png"),
            "w1",
            &mut rollbacks,
        )
        .unwrap();
        assert_eq!(archive.new_source, "image.png");
        assert_eq!(
            std::fs::read(dir.path().join("archive/image.png")).unwrap(),
            before
        );
        finalize_edited_image("w1", &archive.rollback_id, false, &mut rollbacks).unwrap();
        assert_eq!(std::fs::read(dir.path().join("image.png")).unwrap(), before);
        assert!(!dir.path().join("archive/image.png").exists());
    }
    #[test]
    fn save_rejects_conflict_collision_and_other_window_rollback() {
        let (dir, doc, before, after) = fixture();
        let mut rollbacks = HashMap::new();
        std::fs::write(dir.path().join("edited.png"), &before).unwrap();
        assert!(save_edited_image(
            &request(&doc, "image.png", &before, &after, "new", "edited.png"),
            "w1",
            &mut rollbacks
        )
        .is_err());
        std::fs::write(dir.path().join("image.png"), &after).unwrap();
        assert!(save_edited_image(
            &request(&doc, "image.png", &before, &after, "overwrite", "x.png"),
            "w1",
            &mut rollbacks
        )
        .is_err());
        std::fs::write(dir.path().join("image.png"), &before).unwrap();
        let saved = save_edited_image(
            &request(&doc, "image.png", &before, &after, "overwrite", "x.png"),
            "w1",
            &mut rollbacks,
        )
        .unwrap();
        assert!(finalize_edited_image("w2", &saved.rollback_id, false, &mut rollbacks).is_err());
        assert_eq!(std::fs::read(dir.path().join("image.png")).unwrap(), after);
        finalize_edited_image("w1", &saved.rollback_id, false, &mut rollbacks).unwrap();
    }
    #[test]
    fn archive_uses_suffix_without_renaming_the_referenced_original() {
        let (dir, doc, before, after) = fixture();
        let archive = dir.path().join("archive");
        std::fs::create_dir(&archive).unwrap();
        std::fs::write(archive.join("image.png"), b"older backup").unwrap();
        let mut rollbacks = HashMap::new();

        let saved = save_edited_image(
            &request(&doc, "image.png", &before, &after, "archive", "ignored.png"),
            "w1",
            &mut rollbacks,
        )
        .unwrap();
        assert_eq!(saved.new_source, "image.png");
        assert_eq!(
            std::fs::read(archive.join("image.png")).unwrap(),
            b"older backup"
        );
        assert_eq!(
            std::fs::read(archive.join("image (1).png")).unwrap(),
            before
        );
        finalize_edited_image("w1", &saved.rollback_id, false, &mut rollbacks).unwrap();
        assert_eq!(std::fs::read(dir.path().join("image.png")).unwrap(), before);
        assert!(!archive.join("image (1).png").exists());
    }
    #[test]
    fn rollback_does_not_overwrite_a_file_changed_after_save() {
        let (dir, doc, before, after) = fixture();
        let mut rollbacks = HashMap::new();
        let saved = save_edited_image(
            &request(
                &doc,
                "image.png",
                &before,
                &after,
                "overwrite",
                "ignored.png",
            ),
            "w1",
            &mut rollbacks,
        )
        .unwrap();
        let external = png();
        assert_ne!(external, after);
        std::fs::write(dir.path().join("image.png"), &external).unwrap();

        assert!(finalize_edited_image("w1", &saved.rollback_id, false, &mut rollbacks).is_err());
        assert_eq!(
            std::fs::read(dir.path().join("image.png")).unwrap(),
            external
        );
        assert!(rollbacks.contains_key(&saved.rollback_id));
    }
    #[test]
    fn window_close_rolls_back_owned_save_and_reports_external_conflict() {
        let (dir, doc, before, after) = fixture();
        let state = CodexImageSaveRollbacks::default();
        let _saved = {
            let mut entries = state.0.lock().unwrap();
            save_edited_image(
                &request(&doc, "image.png", &before, &after, "new", "編集後.png"),
                "w1",
                &mut entries,
            )
            .unwrap()
        };
        assert!(dir.path().join("編集後.png").exists());
        state.close_window("w1").unwrap();
        assert!(!dir.path().join("編集後.png").exists());

        let saved = {
            let mut entries = state.0.lock().unwrap();
            save_edited_image(
                &request(
                    &doc,
                    "image.png",
                    &before,
                    &after,
                    "overwrite",
                    "ignored.png",
                ),
                "w1",
                &mut entries,
            )
            .unwrap()
        };
        std::fs::write(dir.path().join("image.png"), png()).unwrap();
        assert!(state.close_window("w1").is_err());
        assert!(state.0.lock().unwrap().contains_key(&saved.rollback_id));
    }
    #[cfg(windows)]
    #[test]
    fn archive_rejects_junction_that_leaves_the_document_folder() {
        use std::process::Command;

        let (dir, doc, before, after) = fixture();
        let outside = tempfile::tempdir().unwrap();
        let junction = dir.path().join("archive");
        let script = "$ErrorActionPreference = 'Stop'; New-Item -ItemType Junction -Path $env:MDV_TEST_JUNCTION -Target $env:MDV_TEST_TARGET | Out-Null";
        let status = Command::new("pwsh")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("MDV_TEST_JUNCTION", &junction)
            .env("MDV_TEST_TARGET", outside.path())
            .status()
            .unwrap();
        assert!(status.success());
        let mut rollbacks = HashMap::new();
        assert!(save_edited_image(
            &request(&doc, "image.png", &before, &after, "archive", "ignored.png"),
            "w1",
            &mut rollbacks
        )
        .is_err());
        assert_eq!(std::fs::read(dir.path().join("image.png")).unwrap(), before);
        assert!(std::fs::read_dir(outside.path()).unwrap().next().is_none());
    }
}
