use crate::errors::{AppError, AppResult};
use crate::file_lock::{atomic_write, with_lock};
use serde_json::{Map, Value};
use std::fs;
use std::path::Path;

pub fn load_settings(path: &Path) -> AppResult<Value> {
    with_lock(path, || load_settings_unlocked(path))
}

pub fn merge_settings(path: &Path, updates: Map<String, Value>) -> AppResult<Value> {
    with_lock(path, || {
        let mut current = load_settings_unlocked(path)?;
        let object = current.as_object_mut().ok_or_else(|| AppError::IoError("settings root must be an object".into()))?;
        object.insert("schemaVersion".into(), Value::from(1));
        object.extend(updates);
        atomic_write(path, serde_json::to_vec_pretty(&current).map_err(|e| AppError::IoError(e.to_string()))?.as_slice())?;
        Ok(current)
    })
}

/// Merge one document's fold state without replacing the states saved by other
/// windows/processes for different documents.
pub fn merge_fold_state(path: &Path, document_path: String, state: Value) -> AppResult<Value> {
    if !state.is_object() {
        return Err(AppError::IoError("fold state must be an object".into()));
    }

    with_lock(path, || {
        let mut current = load_settings_unlocked(path)?;
        let object = current
            .as_object_mut()
            .ok_or_else(|| AppError::IoError("settings root must be an object".into()))?;
        object.insert("schemaVersion".into(), Value::from(1));
        let fold_states = object
            .entry("foldStates")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .ok_or_else(|| AppError::IoError("foldStates must be an object".into()))?;
        fold_states.insert(document_path, state);
        atomic_write(path, serde_json::to_vec_pretty(&current).map_err(|e| AppError::IoError(e.to_string()))?.as_slice())?;
        Ok(current)
    })
}

fn load_settings_unlocked(path: &Path) -> AppResult<Value> {
    match fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(value) if value.is_object() => Ok(value),
            Ok(_) | Err(_) => {
                let corrupt = path.with_extension(format!("corrupt.{}.json", chrono::Utc::now().timestamp_millis()));
                fs::rename(path, corrupt).map_err(|error| AppError::IoError(error.to_string()))?;
                Ok(Value::Object(Map::new()))
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Value::Object(Map::new())),
        Err(error) => Err(AppError::IoError(error.to_string())),
    }
}

#[cfg(test)]
mod tests {
 use super::*; use std::sync::{Arc, Barrier}; use std::thread; use tempfile::tempdir;
 #[test] fn merges_independent_keys() { let dir=tempdir().unwrap(); let p=dir.path().join("settings.json"); let mut a=Map::new(); a.insert("theme".into(), Value::from("dark")); merge_settings(&p,a).unwrap(); let mut b=Map::new(); b.insert("zoom".into(), Value::from(125)); let result=merge_settings(&p,b).unwrap(); assert_eq!(result["theme"], "dark"); assert_eq!(result["zoom"],125); }
 #[test] fn corrupt_settings_are_quarantined() { let dir=tempdir().unwrap(); let p=dir.path().join("settings.json"); fs::write(&p, "not json").unwrap(); assert!(load_settings(&p).unwrap().is_object()); assert!(!p.exists()); assert!(fs::read_dir(dir.path()).unwrap().any(|entry| entry.unwrap().file_name().to_string_lossy().starts_with("settings.corrupt."))); }
 #[test] fn merges_fold_state_by_document_path() { let dir=tempdir().unwrap(); let p=dir.path().join("settings.json"); merge_fold_state(&p, "a.md".into(), serde_json::json!({"a": true})).unwrap(); let result=merge_fold_state(&p, "b.md".into(), serde_json::json!({"b": false})).unwrap(); assert_eq!(result["foldStates"]["a.md"]["a"], true); assert_eq!(result["foldStates"]["b.md"]["b"], false); }
 #[test] fn concurrent_key_updates_preserve_both_values() { let dir=tempdir().unwrap(); let p=dir.path().join("settings.json"); let barrier=Arc::new(Barrier::new(2)); let mut workers=Vec::new(); for (key, value) in [("theme", "dark"), ("viewMode", "compact")] { let path=p.clone(); let gate=barrier.clone(); workers.push(thread::spawn(move || { gate.wait(); let mut update=Map::new(); update.insert(key.into(), Value::from(value)); merge_settings(&path, update).unwrap(); })); } for worker in workers { worker.join().unwrap(); } let result=load_settings(&p).unwrap(); assert_eq!(result["theme"], "dark"); assert_eq!(result["viewMode"], "compact"); }
}
