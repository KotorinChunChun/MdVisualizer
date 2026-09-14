use crate::file_lock::{atomic_write, with_lock};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SKILLS_DIRECTORY: &str = "codex-skills";
const INITIALIZED_MARKER: &str = ".defaults-initialized";
const MAX_SKILL_BYTES: usize = 128 * 1024;
const MAX_SKILLS: usize = 100;
const SETTINGS_SKILL: &str = include_str!("../../src/features/codex/default-skills/app-settings/SKILL.md");

const DEFAULT_SKILLS: &[(&str, &str)] = &[
    (
        "edit-image",
        include_str!("../../src/features/codex/default-skills/edit-image/SKILL.md"),
    ),
    (
        "consult",
        include_str!("../../src/features/codex/default-skills/consult/SKILL.md"),
    ),
    (
        "edit",
        include_str!("../../src/features/codex/default-skills/edit/SKILL.md"),
    ),
    (
        "edit-diagram",
        include_str!("../../src/features/codex/default-skills/edit-diagram/SKILL.md"),
    ),
    (
        "explain-image",
        include_str!("../../src/features/codex/default-skills/explain-image/SKILL.md"),
    ),
    (
        "improve-diagram",
        include_str!("../../src/features/codex/default-skills/improve-diagram/SKILL.md"),
    ),
    (
        "transcribe",
        include_str!("../../src/features/codex/default-skills/transcribe/SKILL.md"),
    ),
    (
        "transcribe-table",
        include_str!("../../src/features/codex/default-skills/transcribe-table/SKILL.md"),
    ),
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSkillFile {
    pub id: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSkillFiles {
    pub directory: String,
    pub files: Vec<CodexSkillFile>,
}

fn skills_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(SKILLS_DIRECTORY))
        .map_err(|error| format!("Codexスキル保存先を取得できません: {error}"))
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 100
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn safe_skill_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(
            "スキルIDが不正です。英数字、ハイフン、アンダースコアのみ使用できます。".into(),
        );
    }
    fs::create_dir_all(root)
        .map_err(|error| format!("Codexスキル保存先を作成できません: {error}"))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Codexスキル保存先を確認できません: {error}"))?;
    let directory = root.join(id);
    if directory.exists() {
        let canonical_directory = directory
            .canonicalize()
            .map_err(|error| format!("スキルフォルダーを確認できません: {error}"))?;
        if !canonical_directory.starts_with(&canonical_root) {
            return Err("スキルフォルダーが保存先の外側を指しています。".into());
        }
    }
    let path = directory.join("SKILL.md");
    if path.exists() {
        let canonical_path = path
            .canonicalize()
            .map_err(|error| format!("スキルファイルを確認できません: {error}"))?;
        if !canonical_path.starts_with(&canonical_root) {
            return Err("スキルファイルが保存先の外側を指しています。".into());
        }
    }
    Ok(path)
}

fn ensure_defaults(root: &Path) -> Result<(), String> {
    // 既存利用者にも新規スキルだけ一度配布する。削除・編集済みのスキルは復元しない。
    let settings_marker = root.join(".app-settings-initialized");
    if !settings_marker.exists() {
        let path = safe_skill_path(root, "app-settings")?;
        if !path.exists() {
            fs::create_dir_all(path.parent().ok_or("スキルフォルダーを取得できません。")?).map_err(|error| error.to_string())?;
            atomic_write(&path, SETTINGS_SKILL.as_bytes()).map_err(|error| error.to_string())?;
        }
        atomic_write(&settings_marker, b"initialized\n").map_err(|error| error.to_string())?;
    }
    let marker = root.join(INITIALIZED_MARKER);
    if marker.exists() {
        return Ok(());
    }
    for (id, source) in DEFAULT_SKILLS {
        let path = safe_skill_path(root, id)?;
        if !path.exists() {
            if source.len() > MAX_SKILL_BYTES {
                return Err(format!("既定スキル {id} が大きすぎます。"));
            }
            fs::create_dir_all(path.parent().ok_or("スキルフォルダーを取得できません。")?)
                .map_err(|error| format!("既定スキルの保存先を作成できません: {error}"))?;
            atomic_write(&path, source.as_bytes()).map_err(|error| error.to_string())?;
        }
    }
    atomic_write(&marker, b"initialized\n").map_err(|error| error.to_string())
}

fn list_skills(root: &Path) -> Result<Vec<CodexSkillFile>, String> {
    let mut files = Vec::new();
    let entries =
        fs::read_dir(root).map_err(|error| format!("Codexスキル一覧を読み込めません: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Codexスキル一覧を読み込めません: {error}"))?;
        let directory = entry.path();
        if !directory.is_dir() || entry.file_name() == INITIALIZED_MARKER {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        if !valid_id(&id) {
            continue;
        }
        let path = safe_skill_path(root, &id)?;
        if !path.is_file() {
            continue;
        }
        let source = fs::read_to_string(&path)
            .map_err(|error| format!("スキル {id} を読み込めません: {error}"))?;
        if source.len() > MAX_SKILL_BYTES {
            return Err(format!("スキル {id} が大きすぎます。"));
        }
        files.push(CodexSkillFile { id, source });
    }
    files.sort_by(|left, right| left.id.cmp(&right.id));
    if files.len() > MAX_SKILLS {
        return Err("Codexスキルが多すぎます。最大100件までです。".into());
    }
    Ok(files)
}

#[tauri::command]
pub fn codex_list_skills(app: AppHandle) -> Result<CodexSkillFiles, String> {
    let root = skills_directory(&app)?;
    with_lock(&root.join(".lock"), || {
        ensure_defaults(&root).map_err(crate::errors::AppError::IoError)?;
        list_skills(&root).map_err(crate::errors::AppError::IoError)
    })
    .map(|files| CodexSkillFiles {
        directory: root.to_string_lossy().into_owned(),
        files,
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn codex_save_skill(app: AppHandle, id: String, source: String) -> Result<(), String> {
    if source.len() > MAX_SKILL_BYTES {
        return Err("スキルが大きすぎます。128KB以内にしてください。".into());
    }
    let root = skills_directory(&app)?;
    let path = safe_skill_path(&root, &id)?;
    with_lock(&root.join(".lock"), || {
        fs::create_dir_all(path.parent().ok_or_else(|| {
            crate::errors::AppError::IoError("スキルフォルダーを取得できません。".into())
        })?)
        .map_err(|error| {
            crate::errors::AppError::IoError(format!("スキルフォルダーを作成できません: {error}"))
        })?;
        atomic_write(&path, source.as_bytes())
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn codex_delete_skill(app: AppHandle, id: String) -> Result<(), String> {
    let root = skills_directory(&app)?;
    let path = safe_skill_path(&root, &id)?;
    with_lock(&root.join(".lock"), || {
        if path.exists() {
            fs::remove_file(&path).map_err(|error| {
                crate::errors::AppError::IoError(format!("スキルを削除できません: {error}"))
            })?;
        }
        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir(parent);
        }
        Ok(())
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn codex_open_skills_folder(app: AppHandle) -> Result<(), String> {
    let root = skills_directory(&app)?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("Codexスキル保存先を作成できません: {error}"))?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&root)
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "windows"))]
    return Err("スキルフォルダーを開ける環境ではありません。".into());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn validates_ids_and_keeps_paths_inside_root() {
        let root = tempdir().unwrap();
        assert!(safe_skill_path(root.path(), "good_id-1").is_ok());
        assert!(safe_skill_path(root.path(), "../escape").is_err());
        assert!(safe_skill_path(root.path(), "bad/slash").is_err());
    }

    #[test]
    fn initializes_defaults_once_and_does_not_restore_deleted_default() {
        let root = tempdir().unwrap();
        ensure_defaults(root.path()).unwrap();
        let deleted = root.path().join("consult/SKILL.md");
        fs::remove_file(&deleted).unwrap();
        ensure_defaults(root.path()).unwrap();
        assert!(!deleted.exists());
    }

    #[test]
    fn migrates_app_settings_once_for_existing_users_and_does_not_restore_it_after_deletion() {
        let root = tempdir().unwrap();
        // 既存利用者は旧既定スキルのmarkerだけを持つ状態から移行する。
        fs::write(root.path().join(INITIALIZED_MARKER), b"initialized\n").unwrap();
        ensure_defaults(root.path()).unwrap();
        let settings = root.path().join("app-settings/SKILL.md");
        assert_eq!(fs::read_to_string(&settings).unwrap(), SETTINGS_SKILL);
        assert!(root.path().join(".app-settings-initialized").is_file());
        fs::remove_file(&settings).unwrap();
        fs::remove_dir(root.path().join("app-settings")).unwrap();
        ensure_defaults(root.path()).unwrap();
        assert!(!settings.exists());
    }

    #[test]
    fn lists_sorted_skills_and_rejects_oversize_sources() {
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join("zeta")).unwrap();
        fs::create_dir_all(root.path().join("alpha")).unwrap();
        fs::write(root.path().join("zeta/SKILL.md"), "z").unwrap();
        fs::write(root.path().join("alpha/SKILL.md"), "a").unwrap();
        let files = list_skills(root.path()).unwrap();
        assert_eq!(
            files
                .iter()
                .map(|file| file.id.as_str())
                .collect::<Vec<_>>(),
            ["alpha", "zeta"]
        );
        fs::write(
            root.path().join("alpha/SKILL.md"),
            vec![b'x'; MAX_SKILL_BYTES + 1],
        )
        .unwrap();
        assert!(list_skills(root.path()).is_err());
    }
}
