use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashSet, process::Stdio, time::Duration};
use tokio::{io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader}, process::Command};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexModel {
    pub model: String,
    pub display_name: String,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default, skip_serializing)]
    hidden: bool,
}

async fn send(writer: &mut (impl AsyncWrite + Unpin), value: Value) -> Result<(), String> {
    writer.write_all(format!("{value}\n").as_bytes()).await.map_err(|_| "Codex CLIへ要求を送信できません。")?;
    writer.flush().await.map_err(|_| "Codex CLIへ要求を送信できません。".into())
}

async fn response(reader: &mut (impl tokio::io::AsyncBufRead + Unpin), id: u64) -> Result<Value, String> {
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).await.map_err(|_| "Codex CLIの応答を読めません。")? == 0 {
            return Err("Codex CLIの応答が終了したか、サイズ上限を超えました。".into());
        }
        let value: Value = serde_json::from_str(&line).map_err(|_| "Codex CLIの応答形式が不正です。")?;
        if value.get("id").and_then(Value::as_u64) != Some(id) { continue; }
        if value.get("error").is_some() {
            // CLIの生エラーに利用者情報が含まれる場合があるため、そのまま返さない。
            return Err("Codex CLIがモデル一覧の取得を拒否しました。CLIの更新とログイン状態を確認してください。".into());
        }
        return value.get("result").cloned().ok_or_else(|| "Codex CLIの応答に結果がありません。".into());
    }
}

async fn query(reader: impl AsyncRead + Unpin, mut writer: impl AsyncWrite + Unpin) -> Result<Vec<CodexModel>, String> {
    // 全ページ・通知を含め2MBまで。無制限の行や通知でメモリーを消費しない。
    let mut reader = BufReader::new(reader.take(2_000_000));
    send(&mut writer, json!({"id":0,"method":"initialize","params":{"clientInfo":{"name":"mdvisualizer","title":"MdVisualizer","version":env!("CARGO_PKG_VERSION")}}})).await?;
    response(&mut reader, 0).await?;
    send(&mut writer, json!({"method":"initialized","params":{}})).await?;
    let mut models = Vec::new();
    let mut seen = HashSet::new();
    let mut cursors = HashSet::new();
    let mut cursor: Option<String> = None;
    for id in 1..=32 {
        send(&mut writer, json!({"id":id,"method":"model/list","params":{"limit":100,"includeHidden":false,"cursor":cursor}})).await?;
        let result = response(&mut reader, id).await?;
        let page: Vec<CodexModel> = serde_json::from_value(result.get("data").cloned().ok_or("モデル一覧がありません。")?)
            .map_err(|_| "モデル一覧の形式が不正です。")?;
        for mut model in page {
            if model.hidden || model.model.trim().is_empty() || !seen.insert(model.model.clone()) { continue; }
            if model.display_name.trim().is_empty() { model.display_name = model.model.clone(); }
            models.push(model);
        }
        match result.get("nextCursor") {
            None | Some(Value::Null) => return if models.is_empty() { Err("Codex CLIから選択可能なモデルが返りませんでした。ログイン状態を確認して更新してください。".into()) } else { Ok(models) },
            Some(Value::String(next)) if !next.is_empty() && cursors.insert(next.clone()) => cursor = Some(next.clone()),
            _ => return Err("モデル一覧のページ情報が不正です。".into()),
        }
    }
    Err("モデル一覧のページ数が上限を超えました。".into())
}

async fn run(mut command: Command, timeout: Duration) -> Result<Vec<CodexModel>, String> {
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|_| "Codex CLIを起動できません。")?;
    let result = tokio::time::timeout(timeout, query(child.stdout.take().ok_or("CLI出力なし")?, child.stdin.take().ok_or("CLI入力なし")?))
        .await.unwrap_or_else(|_| Err("モデル一覧の取得がタイムアウトしました。CLIのログイン・接続を確認して再試行してください。".into()));
    // 一覧取得専用の子processだけを終了する。既存CLIや会話には触れない。
    let _ = child.kill().await;
    let _ = child.wait().await;
    result
}

#[tauri::command]
pub async fn codex_list_models() -> Result<Vec<CodexModel>, String> {
    let mut command = Command::new(crate::codex::find_codex_executable()?);
    command.arg("app-server");
    run(command, Duration::from_secs(30)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn lists_pages_in_cli_order_and_filters_hidden_and_duplicates() {
        let input = concat!(
            "{\"id\":0,\"result\":{}}\n",
            "{\"method\":\"notice\"}\n",
            "{\"id\":1,\"result\":{\"data\":[{\"model\":\"cli-new\",\"displayName\":\"New\",\"isDefault\":true},{\"model\":\"hidden\",\"displayName\":\"Hidden\",\"hidden\":true}],\"nextCursor\":\"p2\"}}\n",
            "{\"id\":2,\"result\":{\"data\":[{\"model\":\"cli-new\",\"displayName\":\"Duplicate\"},{\"model\":\"other\",\"displayName\":\"\"}],\"nextCursor\":null}}\n"
        );
        let mut sent = Vec::new();
        let models = query(input.as_bytes(), &mut sent).await.unwrap();
        assert_eq!(models.iter().map(|m| m.model.as_str()).collect::<Vec<_>>(), ["cli-new", "other"]);
        assert!(models[0].is_default);
        assert_eq!(models[1].display_name, "other");
        let messages = String::from_utf8(sent).unwrap().lines().map(|line| serde_json::from_str::<Value>(line).unwrap()).collect::<Vec<_>>();
        assert_eq!(messages[1]["method"], "initialized");
        assert_eq!(messages[3]["params"]["cursor"], "p2");
        assert!(messages.iter().all(|m| m["method"] != "turn/start"));
    }
    #[tokio::test]
    async fn rejects_empty_malformed_and_cli_errors_without_exposing_raw_data() {
        for input in ["{\"id\":0,\"error\":{\"message\":\"SECRET\"}}\n", "invalid SECRET\n", "{\"id\":0,\"result\":{}}\n{\"id\":1,\"result\":{\"data\":[]}}\n"] {
            let error = query(input.as_bytes(), tokio::io::sink()).await.unwrap_err();
            assert!(!error.contains("SECRET"));
        }
    }
    #[tokio::test]
    async fn rejects_repeated_cursor_instead_of_looping() {
        let page = json!({"data":[{"model":"one","displayName":"One"}],"nextCursor":"same"});
        let input = format!("{}\n{}\n{}\n", json!({"id":0,"result":{}}), json!({"id":1,"result":page}), json!({"id":2,"result":page}));
        assert!(query(input.as_bytes(), tokio::io::sink()).await.unwrap_err().contains("ページ情報"));
    }
    #[tokio::test]
    async fn rejects_oversized_response() {
        let input = "x".repeat(2_000_001);
        assert!(query(input.as_bytes(), tokio::io::sink()).await.is_err());
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn timeout_stops_only_the_spawned_child() {
        let mut command = Command::new("pwsh");
        command.args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"]);
        assert!(run(command, Duration::from_millis(200)).await.unwrap_err().contains("タイムアウト"));
    }
    #[tokio::test]
    #[ignore = "実Codex CLIのモデル一覧取得。推論は実行しない"]
    async fn installed_cli_model_list() {
        let models = codex_list_models().await.unwrap();
        assert!(!models.is_empty());
        println!("{}", serde_json::to_string(&models).unwrap());
    }
}
