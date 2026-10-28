//! KotorinToys管理契約2。常駐は追加せず、終了は既存の全ウィンドウ終了ガードへ渡す。
#[cfg(windows)]
mod pipe;
use std::collections::HashSet;
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};
use serde::Deserialize;
use tauri::{Emitter, Manager};

struct Pending {
    id: String,
    deadline: Instant,
    labels: HashSet<String>,
    sender: mpsc::Sender<(String, bool)>,
}
#[derive(Default)]
pub struct Management {
    ready: Mutex<HashSet<String>>,
    pending: Mutex<Option<Pending>>,
}

#[tauri::command]
pub fn management_ready(window: tauri::WebviewWindow, management: tauri::State<'_, Management>) {
    management.ready.lock().unwrap().insert(window.label().into());
}

#[tauri::command]
pub fn management_stop_reply(window: tauri::WebviewWindow, management: tauri::State<'_, Management>, id: String, allowed: bool) {
    let mut pending = management.pending.lock().unwrap();
    if let Some(request) = pending.as_mut() {
        if request.id == id && Instant::now() < request.deadline && request.labels.remove(window.label()) {
            let _ = request.sender.send((window.label().into(), allowed));
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Request { command: String, #[serde(default)] request_id: String, expected_pid: Option<u32> }

fn parse_request(line: &str) -> anyhow::Result<Request> {
    anyhow::ensure!(line.len() <= 8192, "管理要求が長すぎます。");
    if line == "status" { return Ok(Request { command: line.into(), ..Request::default() }); }
    let value: Request = serde_json::from_str(line)?;
    anyhow::ensure!(value.request_id.len() <= 128, "要求IDが長すぎます。");
    Ok(value)
}

fn all_ready(labels: &HashSet<String>, ready: &HashSet<String>) -> bool {
    !labels.is_empty() && labels.is_subset(ready)
}

#[cfg(windows)]
pub fn start(app: tauri::AppHandle) -> anyhow::Result<()> {
    let (tx, rx) = mpsc::sync_channel(1);
    std::thread::Builder::new().name("mdvisualizer-management".into()).spawn(move || {
        let id = app.state::<crate::launch_options::LaunchOptions>().management_id();
        let server = match pipe::ManagementPipe::create(&id) {
            Ok(server) => { let _ = tx.send(Ok(())); server }
            Err(error) => { let _ = tx.send(Err(error)); return; }
        };
        loop {
            if server.accept(Duration::from_millis(100)).is_err() { continue; }
            let deadline = Instant::now() + Duration::from_millis(1800);
            let parsed = server.read_line(deadline).and_then(|line| parse_request(&line));
            let request = parsed.as_ref().ok();
            let labels: HashSet<String> = app.webview_windows().into_keys().collect();
            let management = app.state::<Management>();
            let ready = all_ready(&labels, &management.ready.lock().unwrap());
            let (mut result, mut detail) = ("completed", "");
            let mut stop = false;
            if !server.same_session().unwrap_or(false) { result = "refused"; detail = "対話セッションが一致しません。"; }
            else if let Some(request) = request {
                match request.command.as_str() {
                    "status" => {},
                    "show" | "stop" if request.expected_pid != Some(std::process::id()) => { result = "refused"; detail = "対象PIDが一致しません。"; },
                    "show" | "stop" if !ready => { result = "refused"; detail = "全画面の準備が完了していません。"; },
                    "show" => {
                        let (tx, rx) = mpsc::sync_channel(1);
                        let ui = app.clone();
                        let _ = app.run_on_main_thread(move || {
                            let shown = Instant::now() < deadline && show(&ui).is_ok();
                            let _ = tx.send(shown);
                        });
                        if !rx.recv_timeout(deadline.saturating_duration_since(Instant::now())).unwrap_or(false) {
                            result = "failed"; detail = "画面を表示できませんでした。";
                        }
                    },
                    "stop" => {
                        let id = format!("{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default());
                        let (tx, rx) = mpsc::channel();
                        *management.pending.lock().unwrap() = Some(Pending { id: id.clone(), deadline, labels: labels.clone(), sender: tx });
                        stop = app.emit("management-stop-check", &id).is_ok();
                        for _ in &labels {
                            if !stop { break; }
                            stop = rx.recv_timeout(deadline.saturating_duration_since(Instant::now()))
                                .map(|(_, allowed)| allowed).unwrap_or(false);
                        }
                        *management.pending.lock().unwrap() = None;
                        if stop { result = "accepted"; }
                        else { result = "refused"; detail = "未保存・保存中・編集中、または終了確認に応答しない画面があります。"; }
                    },
                    _ => { result = "unsupported"; detail = "未対応の操作です。"; }
                }
            } else { result = "failed"; detail = "管理要求が不正です。"; }
            let response = serde_json::json!({ "protocolVersion": 2, "requestId": request.map(|r| r.request_id.as_str()).unwrap_or(""),
                "pid": std::process::id(), "ready": ready, "version": crate::launch_options::product_version(),
                "launchOrigin": app.state::<crate::launch_options::LaunchOptions>().origin, "capabilities": ["status", "show", "stop"],
                "result": result, "detail": detail });
            let written = server.write_line(&response.to_string(), deadline).is_ok();
            server.wait_for_client_close(deadline);
            server.disconnect();
            if stop && written {
                let ui = app.clone();
                let _ = app.run_on_main_thread(move || {
                    // close()を使い、照会後の編集も既存の未保存確認で保護する。exit()/destroy()は使わない。
                    for (_, window) in ui.webview_windows() { let _ = window.close(); }
                });
            }
        }
    })?;
    rx.recv_timeout(Duration::from_secs(3))??;
    Ok(())
}

pub fn show(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(label) = crate::launch_owner_label(app.webview_windows().into_keys()) {
        if let Some(window) = app.get_webview_window(&label) {
            window.show()?; window.unminimize()?; window.set_focus()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_malformed_requests_and_preserves_pid_and_request_id() {
        assert_eq!(parse_request("status").unwrap().command, "status");
        let request = parse_request(r#"{"command":"stop","expectedPid":123,"requestId":"abc"}"#).unwrap();
        assert_eq!(request.expected_pid, Some(123)); assert_eq!(request.request_id, "abc");
        for invalid in ["{".into(), "x".repeat(8193), r#"{"command":"stop","expectedPid":-1}"#.into(),
            format!(r#"{{"command":"stop","requestId":"{}"}}"#, "x".repeat(129))] {
            assert!(parse_request(&invalid).is_err());
        }
    }
    #[test]
    fn every_live_window_must_acknowledge_readiness() {
        let labels = HashSet::from(["main".into(), "viewer".into()]);
        assert!(!all_ready(&labels, &HashSet::from(["main".into()])));
        assert!(all_ready(&labels, &labels));
        assert!(!all_ready(&HashSet::new(), &labels));
    }
}
