use crate::errors::AppError;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenExternalAppRequest {
    executable: String,
    args: Vec<String>,
    working_directory: Option<String>,
    file: String,
    line: Option<u32>,
}

pub(super) fn expand_external_app_value(
    value: &str,
    file: &Path,
    line: u32,
) -> Result<String, String> {
    let directory = file.parent().unwrap_or_else(|| Path::new(""));
    let expanded = value
        .replace("${file}", &file.to_string_lossy())
        .replace("${dir}", &directory.to_string_lossy())
        .replace("${line}", &line.to_string());
    if expanded.contains("${") {
        return Err(format!(
            "Unsupported placeholder in external application value: {value}"
        ));
    }
    Ok(expanded)
}

#[tauri::command]
pub fn open_external_app(request: OpenExternalAppRequest) -> Result<(), String> {
    let mut file = PathBuf::from(&request.file);
    if !file.exists() {
        return Err(AppError::FileNotFound(request.file).to_string());
    }
    if request.executable.trim().is_empty() {
        return Err("External application executable is required.".into());
    }
    #[cfg(target_os = "windows")]
    if request.executable.eq_ignore_ascii_case("mspaint.exe") {
        // Paintはスラッシュ区切りのパスを正しく解釈しないためOS形式へ揃える。
        file = normalize_powershell_path(&std::fs::canonicalize(&file).map_err(|error| error.to_string())?);
    }
    let line = request.line.unwrap_or(1);
    let executable = expand_external_app_value(&request.executable, &file, line)?;
    let mut executable_path = PathBuf::from(&executable);
    #[cfg(target_os = "windows")]
    if executable.eq_ignore_ascii_case("mspaint.exe") {
        // Store版の実行エイリアスがPATHに含まれない環境にも対応する。
        let candidates = [
            std::env::var_os("SystemRoot").map(|root| PathBuf::from(root).join("System32/mspaint.exe")),
            std::env::var_os("LOCALAPPDATA").map(|root| PathBuf::from(root).join("Microsoft/WindowsApps/mspaint.exe")),
        ];
        if let Some(path) = candidates.into_iter().flatten().find(|path| std::fs::symlink_metadata(path).is_ok()) {
            executable_path = path;
        }
    }
    let mut command = Command::new(&executable_path);
    for argument in request.args {
        command.arg(expand_external_app_value(&argument, &file, line)?);
    }
    if let Some(working_directory) = request
        .working_directory
        .filter(|value| !value.trim().is_empty())
    {
        command.current_dir(expand_external_app_value(&working_directory, &file, line)?);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .spawn()
        .map_err(|error| format!("Could not start {executable}: {error}"))?;
    Ok(())
}

const POWERSHELL_SOURCE_LIMIT: usize = 256 * 1024;
const POWERSHELL_OUTPUT_LIMIT: u64 = 1024 * 1024;
const POWERSHELL_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPowerShellRequest {
    pub(super) document_path: String,
    pub(super) language: String,
    pub(super) source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellRunResult {
    pub(super) stdout: String,
    pub(super) stderr: String,
    pub(super) exit_code: Option<i32>,
    pub(super) timed_out: bool,
    truncated: bool,
    duration_ms: u64,
}

pub(super) struct ValidatedPowerShellRequest {
    pub(super) working_directory: PathBuf,
    pub(super) source: String,
}

#[cfg(target_os = "windows")]
pub(super) fn normalize_powershell_path(path: &Path) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{unc}"));
    }
    if let Some(local) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(local);
    }
    path.to_path_buf()
}

#[cfg(not(target_os = "windows"))]
pub(super) fn normalize_powershell_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

fn powershell_set_location(directory: &Path) -> String {
    let literal = directory.to_string_lossy().replace('\'', "''");
    format!("Set-Location -LiteralPath '{literal}'; ")
}

pub(super) fn validate_powershell_request(
    request: RunPowerShellRequest,
) -> Result<ValidatedPowerShellRequest, String> {
    if !matches!(
        request.language.trim().to_ascii_lowercase().as_str(),
        "powershell" | "pwsh" | "ps1"
    ) {
        return Err("Only powershell, pwsh, and ps1 code blocks can be executed.".into());
    }
    if request.source.trim().is_empty() {
        return Err("PowerShell source is empty.".into());
    }
    if request.source.len() > POWERSHELL_SOURCE_LIMIT {
        return Err(format!(
            "PowerShell source exceeds the {POWERSHELL_SOURCE_LIMIT} byte limit."
        ));
    }
    let document_path = std::fs::canonicalize(&request.document_path)
        .map_err(|error| format!("Could not resolve Markdown document path: {error}"))?;
    if !document_path.is_file() {
        return Err("The Markdown document path is not a file.".into());
    }
    let is_markdown = document_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        });
    if !is_markdown {
        return Err("PowerShell code can only be executed from a Markdown document.".into());
    }
    let working_directory = normalize_powershell_path(
        document_path
            .parent()
            .ok_or_else(|| "The Markdown document has no containing directory.".to_string())?,
    );
    if !working_directory.is_dir() {
        return Err("The working directory is not a directory.".into());
    }
    Ok(ValidatedPowerShellRequest {
        working_directory,
        source: request.source,
    })
}

fn read_limited_output<R: Read + Send + 'static>(
    reader: R,
) -> std::thread::JoinHandle<Result<(String, bool), String>> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        reader
            .take(POWERSHELL_OUTPUT_LIMIT + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("Could not read PowerShell output: {error}"))?;
        let truncated = bytes.len() as u64 > POWERSHELL_OUTPUT_LIMIT;
        if truncated {
            bytes.truncate(POWERSHELL_OUTPUT_LIMIT as usize);
        }
        Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
    })
}

pub(super) fn run_powershell_process(
    request: ValidatedPowerShellRequest,
    timeout: Duration,
) -> Result<PowerShellRunResult, String> {
    let started = Instant::now();
    let utf8_preamble = "$OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $PSStyle.OutputRendering = 'PlainText'; ";
    let encoded_source = utf8_preamble.to_owned()
        + &powershell_set_location(&request.working_directory)
        + &request.source;
    let encoded_command = base64::engine::general_purpose::STANDARD.encode(
        encoded_source
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    let mut command = Command::new("pwsh");
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            &encoded_command,
        ])
        .current_dir(&request.working_directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "PowerShell 7 (pwsh) が見つかりません。Microsoft Store から『PowerShell』をインストールしてから再実行してください。".to_string()
            } else {
                format!("Could not start pwsh: {error}")
            }
        })?;
    let stdout_reader = read_limited_output(
        child
            .stdout
            .take()
            .ok_or_else(|| "PowerShell stdout was unavailable.".to_string())?,
    );
    let stderr_reader = read_limited_output(
        child
            .stderr
            .take()
            .ok_or_else(|| "PowerShell stderr was unavailable.".to_string())?,
    );

    let (status, timed_out) = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Could not query pwsh status: {error}"))?
        {
            break (status, false);
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let status = child
                .wait()
                .map_err(|error| format!("Could not stop timed out pwsh: {error}"))?;
            break (status, true);
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let (stdout, stdout_truncated) = stdout_reader
        .join()
        .map_err(|_| "PowerShell stdout reader stopped unexpectedly.".to_string())??;
    let (stderr, stderr_truncated) = stderr_reader
        .join()
        .map_err(|_| "PowerShell stderr reader stopped unexpectedly.".to_string())??;
    Ok(PowerShellRunResult {
        stdout,
        stderr,
        exit_code: status.code(),
        timed_out,
        truncated: stdout_truncated || stderr_truncated,
        duration_ms: started.elapsed().as_millis().try_into().unwrap_or(u64::MAX),
    })
}

#[tauri::command]
pub async fn run_powershell(request: RunPowerShellRequest) -> Result<PowerShellRunResult, String> {
    let validated = validate_powershell_request(request)?;
    tauri::async_runtime::spawn_blocking(move || {
        run_powershell_process(validated, POWERSHELL_TIMEOUT)
    })
    .await
    .map_err(|error| format!("PowerShell worker failed: {error}"))?
}

#[tauri::command]
pub fn open_external_url(app_handle: AppHandle, url: String) -> Result<(), String> {
    if !is_allowed_external_url(&url) {
        return Err("Only HTTP(S) and mailto URLs may be opened externally.".into());
    }
    app_handle
        .opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

pub(super) fn is_allowed_external_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")
}
