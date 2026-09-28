//! 採用前はキャッシュだけへ保存し、最終ファイル名を固定してから比較する。
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, State, WebviewWindow};

#[derive(Default)]
pub struct CandidatePlans(Mutex<HashMap<String, CandidatePlan>>);
struct CandidatePlan {
    owner: String,
    cache: tempfile::TempDir,
    parent: PathBuf,
    destination: PathBuf,
    bytes: Vec<u8>,
    committed: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateRequest {
    document_path: String,
    base64: String,
    filename: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateReply {
    id: String,
    source: String,
    preview_dir: String,
}

fn prepare(
    parent: &Path,
    folder: &str,
    filename: &str,
    bytes: Vec<u8>,
    owner: &str,
) -> Result<(CandidatePlan, CandidateReply), String> {
    let parent = parent
        .canonicalize()
        .map_err(|_| "Markdownの保存先を確認できません。")?;
    let name = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("generated");
    let safe: String = name
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_'))
        .take(80)
        .collect();
    let stem = if safe.is_empty() { "generated" } else { &safe };
    let cache = tempfile::Builder::new()
        .prefix("mdvisualizer-candidate-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    // セッション間でも衝突しない名前を比較前に固定。採用時は排他的作成で再検査する。
    let id = format!(
        "{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    let filename = format!("{stem}-{id}.png");
    let source = if folder == "image" {
        format!("image/{filename}")
    } else {
        filename
    };
    let cached = cache.path().join(&source);
    fs::create_dir_all(cached.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&cached, &bytes).map_err(|e| e.to_string())?;
    let reply = CandidateReply {
        id,
        source: source.clone(),
        preview_dir: cache.path().to_string_lossy().into(),
    };
    Ok((
        CandidatePlan {
            owner: owner.into(),
            cache,
            destination: parent.join(source),
            parent,
            bytes,
            committed: false,
        },
        reply,
    ))
}

#[tauri::command]
pub fn codex_prepare_candidate(
    app: AppHandle,
    window: WebviewWindow,
    plans: State<'_, CandidatePlans>,
    request: CandidateRequest,
) -> Result<CandidateReply, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(request.base64)
        .map_err(|_| "画像データが不正です。")?;
    if bytes.len() > 10 * 1024 * 1024
        || image::guess_format(&bytes).ok() != Some(image::ImageFormat::Png)
    {
        return Err("PNG画像は10MB以下にしてください。".into());
    }
    let dimensions =
        image::ImageReader::with_format(std::io::Cursor::new(&bytes), image::ImageFormat::Png)
            .into_dimensions()
            .map_err(|_| "画像が破損しています。")?;
    if u64::from(dimensions.0) * u64::from(dimensions.1) > 40_000_000 {
        return Err("画像は4,000万画素以下にしてください。".into());
    }
    let document = PathBuf::from(request.document_path);
    if !document.is_absolute() {
        return Err("先にMarkdownの保存先を選んでください。".into());
    }
    let settings = crate::commands::load_settings(app)?;
    // 生成画像はMarkdownと共に移動できる相対配置。絶対パス設定の場合もimageへ配置する。
    let folder = match settings["clipboardImage"]["pngLocation"].as_str() {
        Some("document" | "fixed") => "",
        _ => "image",
    };
    let (plan, reply) = prepare(
        document
            .parent()
            .ok_or("Markdownの保存先を確認できません。")?,
        folder,
        &request.filename,
        bytes,
        window.label(),
    )?;
    plans
        .0
        .lock()
        .map_err(|_| "候補状態を取得できません。")?
        .insert(reply.id.clone(), plan);
    Ok(reply)
}
#[tauri::command]
pub fn codex_candidate_preview(
    window: WebviewWindow,
    plans: State<'_, CandidatePlans>,
    id: String,
    markdown: String,
) -> Result<(), String> {
    let plans = plans.0.lock().map_err(|_| "候補状態を取得できません。")?;
    let plan = plans
        .get(&id)
        .filter(|p| p.owner == window.label())
        .ok_or("画像候補を準備し直してください。")?;
    if markdown.len() > 30 * 1024 * 1024 {
        return Err("プレビューが大きすぎます。".into());
    }
    fs::write(plan.cache.path().join("preview.md"), markdown).map_err(|e| e.to_string())
}
fn commit(plan: &mut CandidatePlan) -> Result<(), String> {
    if plan.committed {
        return Ok(());
    }
    let directory = plan
        .destination
        .parent()
        .ok_or("画像の保存先がありません。")?;
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let canonical = directory.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.starts_with(&plan.parent) {
        return Err("画像の保存先がMarkdownのフォルダー外へ変更されました。".into());
    }
    let mut file = tempfile::NamedTempFile::new_in(&canonical).map_err(|e| e.to_string())?;
    file.write_all(&plan.bytes)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    file.persist_noclobber(&plan.destination)
        .map_err(|_| "画像名が既に使用されています。差分確認を開き直してください。")?;
    plan.committed = true;
    Ok(())
}
#[tauri::command]
pub fn codex_commit_candidate(
    window: WebviewWindow,
    plans: State<'_, CandidatePlans>,
    id: String,
) -> Result<(), String> {
    let mut plans = plans.0.lock().map_err(|_| "候補状態を取得できません。")?;
    commit(
        plans
            .get_mut(&id)
            .filter(|p| p.owner == window.label())
            .ok_or("画像候補を準備し直してください。")?,
    )
}
#[tauri::command]
pub fn codex_finish_candidate(
    window: WebviewWindow,
    plans: State<'_, CandidatePlans>,
    id: String,
    accepted: bool,
) -> Result<(), String> {
    let mut plans = plans.0.lock().map_err(|_| "候補状態を取得できません。")?;
    let plan = plans
        .get(&id)
        .filter(|p| p.owner == window.label())
        .ok_or("画像候補を確認できません。")?;
    if !accepted && plan.committed {
        let actual_parent = plan
            .destination
            .parent()
            .ok_or("画像の保存先を確認できません。")?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !actual_parent.starts_with(&plan.parent) {
            return Err("画像の保存先が変更されたため自動削除できません。".into());
        }
        if fs::read(&plan.destination).map_err(|e| e.to_string())? != plan.bytes {
            return Err("採用画像が外部で変更されたため自動削除できません。".into());
        }
        fs::remove_file(&plan.destination).map_err(|e| e.to_string())?;
    }
    plans.remove(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn candidate_is_cached_until_explicit_commit_and_never_overwrites() {
        let root = tempfile::tempdir().unwrap();
        let (mut plan, reply) = prepare(
            root.path(),
            "image",
            "generated.png",
            b"candidate".to_vec(),
            "window",
        )
        .unwrap();
        assert!(plan.cache.path().join(&reply.source).exists());
        assert!(!plan.destination.exists());
        fs::create_dir_all(plan.destination.parent().unwrap()).unwrap();
        fs::write(&plan.destination, b"other").unwrap();
        assert!(commit(&mut plan).is_err());
        assert_eq!(fs::read(&plan.destination).unwrap(), b"other");
        fs::remove_file(&plan.destination).unwrap();
        commit(&mut plan).unwrap();
        drop(plan);
        assert_eq!(
            fs::read(root.path().join(reply.source)).unwrap(),
            b"candidate"
        );
    }
}
