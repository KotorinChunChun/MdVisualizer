use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("Unsupported document type: {0}")]
    UnsupportedDocument(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Image error: {0}")]
    ImageError(String),

    #[error("Backup error: {0}")]
    BackupError(String),

    #[error("Watch error: {0}")]
    WatchError(String),

    #[error("IO error: {0}")]
    IoError(String),

    #[error("Unknown error: {0}")]
    Unknown(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = std::result::Result<T, AppError>;
