param(
    [string]$Model = 'gpt-5.6-luna',
    [ValidateRange(10, 300)][int]$TimeoutSeconds = 90
)

# 任意導入のCodex CLIのみを検証する。本体やユーザー設定は変更しない。
$ErrorActionPreference = 'Stop'
$cli = (Get-Command codex -CommandType Application -ErrorAction Stop).Source
Write-Output "検証モデル: $Model"
& $cli --version
if ($LASTEXITCODE -ne 0) { throw 'CLIの版取得に失敗しました。' }

$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $cli
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8
$startInfo.WorkingDirectory = [System.IO.Path]::GetTempPath()
$prompt = 'This is a deterministic text editing integration test. Do not use tools, read files, or execute commands. Return only a JSON object with status="ok" and revised equal to the following Japanese sentence with every ABC replaced by MarkdownViewer: ABCは文書を表示します。ABCで編集できます。'
foreach ($argument in @('exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '-C', $startInfo.WorkingDirectory, '-s', 'read-only', '-m', $Model, '-c', 'model_reasoning_effort="low"', '--json', $prompt)) {
    $startInfo.ArgumentList.Add($argument)
}
$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $startInfo
try {
    if (-not $process.Start()) { throw 'CLIを起動できませんでした。' }
    $process.StandardInput.Close()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        $process.Kill($true)
        $process.WaitForExit()
        throw "CLIが${TimeoutSeconds}秒以内に完了しませんでした。"
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) {
        # 認証情報や設定が含まれる可能性のある生ログは表示しない。
        throw "CLIが終了コード$($process.ExitCode)で失敗しました。codex login statusで認証状態を確認してください。"
    }
    $events = @($stdout -split '\r?\n' | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
    $completed = @($events | Where-Object type -eq 'turn.completed')
    $messages = @($events | Where-Object { $_.type -eq 'item.completed' -and $_.item.type -eq 'agent_message' })
    $toolItems = @($events | Where-Object { $_.type -eq 'item.completed' -and $_.item.type -notin @('agent_message', 'reasoning') })
    if ($completed.Count -ne 1 -or $messages.Count -eq 0 -or $toolItems.Count -ne 0) { throw '応答完了またはツール未使用の条件を満たしません。' }
    $result = $messages[-1].item.text | ConvertFrom-Json
    if ($result.status -ne 'ok' -or $result.revised -cne 'MarkdownViewerは文書を表示します。MarkdownViewerで編集できます。') {
        throw '日本語編集結果が期待値と一致しません。'
    }
    Write-Output 'PASS: 日本語置換、JSON応答、ターン完了、ツール未使用'
    Write-Output $result.revised
    Write-Output ($completed[0].usage | ConvertTo-Json -Compress)
    if ($stderr.Contains('Shell snapshot not supported yet for PowerShell')) {
        Write-Output '注記: PowerShellのshell snapshot未対応警告あり（応答検証は成功）。'
    }
} finally {
    $process.Dispose()
}
