use crate::errors::{AppError, AppResult};
use crate::file_lock::{atomic_write, with_lock};
use serde::Serialize;
use serde_json::{Map, Value};
use std::fs;
use std::path::Path;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CorruptFileInfo {
    pub source_path: String,
    pub backup_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsLoadResult {
    pub settings: Value,
    pub recovered_files: Vec<CorruptFileInfo>,
}

#[derive(Clone, Debug)]
struct JsonRead {
    value: Value,
    recovered: Option<CorruptFileInfo>,
}

/// Legacy-compatible settings reader. New callers that need recovery
/// information should use `load_application_settings`.
pub fn load_settings(path: &Path) -> AppResult<Value> {
    Ok(load_json(path)?.value)
}

pub fn load_application_settings(
    settings_path: &Path,
    fold_state_path: &Path,
) -> AppResult<SettingsLoadResult> {
    let mut settings = load_json(settings_path)?;
    let mut folds = load_json(fold_state_path)?;
    let mut recovered_files = Vec::new();
    if let Some(info) = settings.recovered.take() {
        recovered_files.push(info);
    }
    if let Some(info) = folds.recovered.take() {
        recovered_files.push(info);
    }

    // v0.1 stored fold state in settings.json. Copy it first, then remove the
    // legacy field; this ordering keeps the old state intact if the process is
    // interrupted between the two writes.
    if let Some(legacy_states) = settings
        .value
        .get("foldStates")
        .cloned()
        .filter(Value::is_object)
    {
        merge_legacy_fold_states(fold_state_path, legacy_states)?;
        remove_legacy_fold_states(settings_path)?;
        folds = load_json(fold_state_path)?;
        if let Some(info) = folds.recovered.take() {
            recovered_files.push(info);
        }
        settings.value = load_json(settings_path)?.value;
    }

    let settings_object = settings
        .value
        .as_object_mut()
        .ok_or_else(|| AppError::IoError("settings root must be an object".into()))?;
    settings_object.insert("foldStates".into(), fold_states_from_root(&folds.value));
    Ok(SettingsLoadResult {
        settings: settings.value,
        recovered_files,
    })
}

pub fn merge_settings(path: &Path, updates: Map<String, Value>) -> AppResult<Value> {
    with_lock(path, || {
        let mut current = load_json_unlocked(path)?.value;
        let object = current
            .as_object_mut()
            .ok_or_else(|| AppError::IoError("settings root must be an object".into()))?;
        let schema_version = object
            .get("schemaVersion")
            .and_then(Value::as_u64)
            .unwrap_or(2)
            .max(2);
        object.insert("schemaVersion".into(), Value::from(schema_version));
        // `foldStates` has its own lock and file from v0.2 onward.
        updates
            .into_iter()
            .filter(|(key, _)| key != "foldStates")
            .for_each(|(key, value)| {
                object.insert(key, value);
            });
        write_json(path, &current)?;
        Ok(current)
    })
}

/// Applies external-app edits by stable ID so a stale settings window cannot
/// replace applications concurrently added by another window.
pub fn merge_external_app_settings(
    path: &Path,
    upserts: Vec<Value>,
    removed_ids: Vec<String>,
    presentation_line_threshold: u64,
    image_a4_target_width: u64,
    image_equal_padding: u64,
) -> AppResult<Value> {
    with_lock(path, || {
        let mut current = load_json_unlocked(path)?.value;
        let object = current
            .as_object_mut()
            .ok_or_else(|| AppError::IoError("settings root must be an object".into()))?;
        let mut apps = object
            .get("externalApps")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        apps.retain(|app| {
            app.get("id")
                .and_then(Value::as_str)
                .is_none_or(|id| !removed_ids.iter().any(|removed| removed == id))
        });
        for replacement in upserts {
            let id = replacement
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::IoError("external app requires an id".into()))?;
            if let Some(index) = apps
                .iter()
                .position(|app| app.get("id").and_then(Value::as_str) == Some(id))
            {
                apps[index] = replacement;
            } else {
                apps.push(replacement);
            }
        }
        apps.sort_by_key(|app| app.get("order").and_then(Value::as_i64).unwrap_or(i64::MAX));
        for (order, app) in apps.iter_mut().enumerate() {
            if let Some(app_object) = app.as_object_mut() {
                app_object.insert("order".into(), Value::from(order as u64));
            }
        }
        object.insert("schemaVersion".into(), Value::from(3));
        object.insert("externalApps".into(), Value::Array(apps));
        object.insert(
            "presentationLineThreshold".into(),
            Value::from(presentation_line_threshold.clamp(1, 100)),
        );
        object.insert(
            "imageA4TargetWidth".into(),
            Value::from(image_a4_target_width.max(1)),
        );
        object.insert(
            "imageEqualPadding".into(),
            Value::from(image_equal_padding),
        );
        write_json(path, &current)?;
        Ok(current)
    })
}

/// Merge one document's fold state without replacing states saved by other
/// windows or processes.
pub fn merge_fold_state(path: &Path, document_path: String, state: Value) -> AppResult<Value> {
    if !state.is_object() {
        return Err(AppError::IoError("fold state must be an object".into()));
    }
    with_lock(path, || {
        let mut current = load_json_unlocked(path)?.value;
        let object = current
            .as_object_mut()
            .ok_or_else(|| AppError::IoError("fold-state root must be an object".into()))?;
        object.insert("schemaVersion".into(), Value::from(1));
        let states = object
            .entry("foldStates")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .ok_or_else(|| AppError::IoError("foldStates must be an object".into()))?;
        states.insert(document_path, state);
        write_json(path, &current)?;
        Ok(current)
    })
}

fn load_json(path: &Path) -> AppResult<JsonRead> {
    with_lock(path, || load_json_unlocked(path))
}

fn load_json_unlocked(path: &Path) -> AppResult<JsonRead> {
    match fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(value) if value.is_object() => Ok(JsonRead {
                value,
                recovered: None,
            }),
            Ok(_) | Err(_) => {
                let info = quarantine_corrupt_file(path)?;
                Ok(JsonRead {
                    value: Value::Object(Map::new()),
                    recovered: Some(info),
                })
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(JsonRead {
            value: Value::Object(Map::new()),
            recovered: None,
        }),
        Err(error) => Err(AppError::IoError(error.to_string())),
    }
}

fn write_json(path: &Path, value: &Value) -> AppResult<()> {
    let content =
        serde_json::to_vec_pretty(value).map_err(|error| AppError::IoError(error.to_string()))?;
    atomic_write(path, &content)
}

fn fold_states_from_root(root: &Value) -> Value {
    root.get("foldStates")
        .cloned()
        .filter(Value::is_object)
        .unwrap_or_else(|| Value::Object(Map::new()))
}

fn merge_legacy_fold_states(path: &Path, legacy_states: Value) -> AppResult<()> {
    let legacy = legacy_states
        .as_object()
        .ok_or_else(|| AppError::IoError("legacy foldStates must be an object".into()))?;
    with_lock(path, || {
        let mut current = load_json_unlocked(path)?.value;
        let root = current
            .as_object_mut()
            .ok_or_else(|| AppError::IoError("fold-state root must be an object".into()))?;
        root.insert("schemaVersion".into(), Value::from(1));
        let states = root
            .entry("foldStates")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .ok_or_else(|| AppError::IoError("foldStates must be an object".into()))?;
        for (document, state) in legacy {
            states
                .entry(document.clone())
                .or_insert_with(|| state.clone());
        }
        write_json(path, &current)
    })
}

fn remove_legacy_fold_states(path: &Path) -> AppResult<()> {
    with_lock(path, || {
        let mut current = load_json_unlocked(path)?.value;
        let root = current
            .as_object_mut()
            .ok_or_else(|| AppError::IoError("settings root must be an object".into()))?;
        if root.remove("foldStates").is_some() {
            root.insert("schemaVersion".into(), Value::from(2));
            write_json(path, &current)?;
        }
        Ok(())
    })
}

fn quarantine_corrupt_file(path: &Path) -> AppResult<CorruptFileInfo> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("settings");
    let extension = path
        .extension()
        .and_then(|name| name.to_str())
        .unwrap_or("json");
    let timestamp = chrono::Utc::now().timestamp_millis();
    let mut attempt = 0_u32;
    let backup = loop {
        let suffix = if attempt == 0 {
            String::new()
        } else {
            format!(".{attempt}")
        };
        let candidate = parent.join(format!("{stem}.corrupt.{timestamp}{suffix}.{extension}"));
        if !candidate.exists() {
            break candidate;
        }
        attempt += 1;
    };
    fs::rename(path, &backup)
        .map_err(|error| AppError::IoError(format!("quarantine corrupt settings: {error}")))?;
    Ok(CorruptFileInfo {
        source_path: path.to_string_lossy().to_string(),
        backup_path: backup.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::{Arc, Barrier};
    use std::thread;
    use tempfile::tempdir;

    #[test]
    fn merges_independent_keys() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut theme = Map::new();
        theme.insert("theme".into(), Value::from("dark"));
        merge_settings(&path, theme).unwrap();
        let mut zoom = Map::new();
        zoom.insert("zoom".into(), Value::from(125));
        let result = merge_settings(&path, zoom).unwrap();
        assert_eq!(result["theme"], "dark");
        assert_eq!(result["zoom"], 125);
    }

    #[test]
    fn concurrent_key_updates_preserve_both_values() {
        let dir = tempdir().unwrap();
        let path = Arc::new(dir.path().join("settings.json"));
        let gate = Arc::new(Barrier::new(2));
        let workers: Vec<_> = [("theme", "dark"), ("viewMode", "compact")]
            .into_iter()
            .map(|(key, value)| {
                let path = Arc::clone(&path);
                let gate = Arc::clone(&gate);
                thread::spawn(move || {
                    gate.wait();
                    let mut update = Map::new();
                    update.insert(key.into(), Value::from(value));
                    merge_settings(&path, update).unwrap();
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        let result = load_settings(&path).unwrap();
        assert_eq!(result["theme"], "dark");
        assert_eq!(result["viewMode"], "compact");
    }

    #[test]
    fn concurrent_external_app_updates_preserve_disjoint_applications() {
        let dir = tempdir().unwrap();
        let path = Arc::new(dir.path().join("settings.json"));
        let gate = Arc::new(Barrier::new(2));
        let workers: Vec<_> = ["app-a", "app-b"]
            .into_iter()
            .enumerate()
            .map(|(order, id)| {
                let path = Arc::clone(&path);
                let gate = Arc::clone(&gate);
                thread::spawn(move || {
                    gate.wait();
                    merge_external_app_settings(
                        &path,
                        vec![serde_json::json!({"id": id, "label": id, "order": order})],
                        vec![],
                        10,
                        3508,
                        32,
                    )
                    .unwrap();
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        let result = load_settings(&path).unwrap();
        let ids: Vec<_> = result["externalApps"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|app| app["id"].as_str())
            .collect();
        assert!(ids.contains(&"app-a"));
        assert!(ids.contains(&"app-b"));
        assert_eq!(result["schemaVersion"], 3);
    }

    #[test]
    fn schema_version_never_downgrades_during_partial_updates() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{"schemaVersion":3,"externalApps":[]}"#).unwrap();
        let mut update = Map::new();
        update.insert("theme".into(), Value::from("light"));
        let result = merge_settings(&path, update).unwrap();
        assert_eq!(result["schemaVersion"], 3);
    }

    #[test]
    fn migrates_legacy_fold_states_into_a_dedicated_file() {
        let dir = tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        let folds = dir.path().join("fold-state.json");
        fs::write(
            &settings,
            r#"{"theme":"dark","foldStates":{"a.md":{"h1":true}}}"#,
        )
        .unwrap();
        let loaded = load_application_settings(&settings, &folds).unwrap();
        assert_eq!(loaded.settings["theme"], "dark");
        assert_eq!(loaded.settings["foldStates"]["a.md"]["h1"], true);
        assert!(load_settings(&settings)
            .unwrap()
            .get("foldStates")
            .is_none());
        assert_eq!(
            load_settings(&folds).unwrap()["foldStates"]["a.md"]["h1"],
            true
        );
    }

    #[test]
    fn corrupt_json_is_quarantined_and_reported() {
        let dir = tempdir().unwrap();
        let settings = dir.path().join("settings.json");
        let folds = dir.path().join("fold-state.json");
        fs::write(&settings, "not json").unwrap();
        let loaded = load_application_settings(&settings, &folds).unwrap();
        assert_eq!(loaded.recovered_files.len(), 1);
        assert!(!settings.exists());
        assert!(PathBuf::from(&loaded.recovered_files[0].backup_path).exists());
    }

    #[test]
    fn fold_states_merge_by_document_without_touching_settings() {
        let dir = tempdir().unwrap();
        let folds = dir.path().join("fold-state.json");
        merge_fold_state(&folds, "a.md".into(), serde_json::json!({"a": true})).unwrap();
        let result =
            merge_fold_state(&folds, "b.md".into(), serde_json::json!({"b": false})).unwrap();
        assert_eq!(result["foldStates"]["a.md"]["a"], true);
        assert_eq!(result["foldStates"]["b.md"]["b"], false);
    }
}
