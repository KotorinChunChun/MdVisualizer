use crate::errors::{AppError, AppResult};
use crate::file_lock::{atomic_write, with_lock};
use serde_json::{Map, Value};
use std::fs;
use std::path::Path;

pub fn load_settings(path: &Path) -> AppResult<Value> {
    with_lock(path, || match fs::read_to_string(path) {
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
    })
}

pub fn merge_settings(path: &Path, updates: Map<String, Value>) -> AppResult<Value> {
    with_lock(path, || {
        let mut current = match fs::read_to_string(path) {
            Ok(text) => serde_json::from_str::<Value>(&text).unwrap_or_else(|_| Value::Object(Map::new())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Value::Object(Map::new()),
            Err(error) => return Err(AppError::IoError(error.to_string())),
        };
        let object = current.as_object_mut().ok_or_else(|| AppError::IoError("settings root must be an object".into()))?;
        object.insert("schemaVersion".into(), Value::from(1));
        object.extend(updates);
        atomic_write(path, serde_json::to_vec_pretty(&current).map_err(|e| AppError::IoError(e.to_string()))?.as_slice())?;
        Ok(current)
    })
}

#[cfg(test)]
mod tests {
 use super::*; use tempfile::tempdir;
 #[test] fn merges_independent_keys() { let dir=tempdir().unwrap(); let p=dir.path().join("settings.json"); let mut a=Map::new(); a.insert("theme".into(), Value::from("dark")); merge_settings(&p,a).unwrap(); let mut b=Map::new(); b.insert("zoom".into(), Value::from(125)); let result=merge_settings(&p,b).unwrap(); assert_eq!(result["theme"], "dark"); assert_eq!(result["zoom"],125); }
 #[test] fn corrupt_settings_are_quarantined() { let dir=tempdir().unwrap(); let p=dir.path().join("settings.json"); fs::write(&p, "not json").unwrap(); assert!(load_settings(&p).unwrap().is_object()); assert!(!p.exists()); assert!(fs::read_dir(dir.path()).unwrap().any(|entry| entry.unwrap().file_name().to_string_lossy().starts_with("settings.corrupt."))); }
}
