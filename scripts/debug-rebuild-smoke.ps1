param(
    [string[]]$FallbackMarkdownPaths = @("$PSScriptRoot\..\samples\v0.0.10-editing.md"),
    [string]$OutputDirectory = (Join-Path ([IO.Path]::GetTempPath()) "markdownviewer-debug-smoke"),
    [int]$RemoteDebuggingPort = 9333,
    [switch]$SkipBuild,
    [switch]$StopAfterTest
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$debugExecutable = Join-Path $projectRoot "src-tauri\target\debug\markdown-viewer.exe"
$analyzer = Join-Path $PSScriptRoot "debug-preview-smoke.mjs"
$runDirectory = Join-Path $OutputDirectory (Get-Date -Format "yyyyMMdd-HHmmss")

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MarkdownViewerInputGuard {
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")]
    static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
    public static uint LastInputTick() {
        LASTINPUTINFO info = new LASTINPUTINFO();
        info.cbSize = (uint)Marshal.SizeOf(info);
        if (!GetLastInputInfo(ref info)) throw new InvalidOperationException("GetLastInputInfo failed");
        return info.dwTime;
    }
}
"@

function Get-MarkdownViewerProcesses {
    @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -in @("markdown-viewer", "MarkdownViewer") -and $_.Path
    })
}

function Get-DebugApplicationState([string]$ExecutablePath, [int]$TimeoutMilliseconds = 3000) {
    $responsePath = Join-Path ([IO.Path]::GetTempPath()) "markdownviewer-debug-state-$([guid]::NewGuid().ToString('N')).json"
    try {
        $query = Start-Process -FilePath $ExecutablePath -ArgumentList @("--debug-query-state", ('"' + $responsePath + '"')) -PassThru
        $query.WaitForExit([Math]::Min($TimeoutMilliseconds, 1500)) | Out-Null
        $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
        do {
            if (Test-Path -LiteralPath $responsePath) {
                try {
                    return Get-Content -LiteralPath $responsePath -Raw | ConvertFrom-Json
                } catch {
                    Start-Sleep -Milliseconds 50
                }
            } else {
                Start-Sleep -Milliseconds 50
            }
        } while ([DateTime]::UtcNow -lt $deadline)
        return $null
    } finally {
        Remove-Item -LiteralPath $responsePath -Force -ErrorAction SilentlyContinue
    }
}

function Get-StableDebugApplicationState([string]$ExecutablePath, [int]$TimeoutSeconds = 5) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $state = Get-DebugApplicationState -ExecutablePath $ExecutablePath -TimeoutMilliseconds 750
        if ($state -and @($state.windows).Count -gt 0) { return $state }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    return $null
}

function Wait-ForMainWindow([Diagnostics.Process]$Process, [int]$TimeoutSeconds = 30) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep -Milliseconds 100
        $Process.Refresh()
    } while ($Process.MainWindowHandle -eq 0 -and -not $Process.HasExited -and [DateTime]::UtcNow -lt $deadline)
    if ($Process.HasExited -or $Process.MainWindowHandle -eq 0) {
        throw "MarkdownViewerのウィンドウが$TimeoutSeconds秒以内に表示されませんでした。"
    }
}

function Wait-ForNoHumanInput {
    $baseline = [MarkdownViewerInputGuard]::LastInputTick()
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 50
        if ([MarkdownViewerInputGuard]::LastInputTick() -ne $baseline) {
            return $false
        }
    }
    return $true
}

$running = Get-MarkdownViewerProcesses
$restoreFiles = [Collections.Generic.List[string]]::new()
if ($running.Count -gt 0) {
    Write-Output "OPEN_WINDOWS_BEFORE_BUILD=$($running.Count)"
    foreach ($process in $running) {
        $state = Get-StableDebugApplicationState -ExecutablePath $process.Path
        if ($state) {
            Write-Output ("OPEN_STATE_BEFORE_BUILD=" + ($state | ConvertTo-Json -Depth 8 -Compress))
            foreach ($window in $state.windows) {
                foreach ($tab in $window.tabs) {
                    if ($tab.kind -eq "document" -and $tab.path -and -not $restoreFiles.Contains([string]$tab.path)) {
                        $restoreFiles.Add([string]$tab.path)
                    }
                }
            }
        } else {
            throw "PID $($process.Id) はデバッグ状態APIに応答しないため、タブを保護して強制終了を中止しました。ウィンドウ: $($process.MainWindowTitle)"
        }
    }
    foreach ($process in $running) {
        Stop-Process -Id $process.Id -Force
        Wait-Process -Id $process.Id -Timeout 10 -ErrorAction SilentlyContinue
        Write-Output "FORCE_STOPPED_PID=$($process.Id)"
    }
}

if ($restoreFiles.Count -eq 0) {
    foreach ($path in $FallbackMarkdownPaths) {
        $resolved = (Resolve-Path $path).Path
        if (-not $restoreFiles.Contains($resolved)) { $restoreFiles.Add($resolved) }
    }
}

if (-not $SkipBuild) {
    $previousDebugApi = $env:VITE_MARKDOWNVIEWER_DEBUG_API
    $env:VITE_MARKDOWNVIEWER_DEBUG_API = "1"
    try {
        Push-Location $projectRoot
        try {
            & npm.cmd run tauri -- build --debug --no-bundle
            if ($LASTEXITCODE -ne 0) { throw "デバッグビルドに失敗しました（終了コード: $LASTEXITCODE）。" }
        } finally {
            Pop-Location
        }
    } finally {
        $env:VITE_MARKDOWNVIEWER_DEBUG_API = $previousDebugApi
    }
}
if (-not (Test-Path -LiteralPath $debugExecutable)) { throw "デバッグ実行ファイルがありません: $debugExecutable" }

New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
$previousWebViewArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$remoteArgument = "--remote-debugging-port=$RemoteDebuggingPort"
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = (@($previousWebViewArguments, $remoteArgument) | Where-Object { $_ }) -join " "
try {
    $quotedFiles = @($restoreFiles | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' })
    $process = Start-Process -FilePath $debugExecutable -ArgumentList $quotedFiles -PassThru
} finally {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousWebViewArguments
}
Wait-ForMainWindow -Process $process

if (-not (Wait-ForNoHumanInput)) {
    Write-Output "HUMAN_INPUT_DETECTED pid=$($process.Id)"
    exit 42
}
Write-Output "SAFE_TO_ANALYZE pid=$($process.Id)"

$restoredState = $null
$stateDeadline = [DateTime]::UtcNow.AddSeconds(20)
do {
    $restoredState = Get-DebugApplicationState -ExecutablePath $debugExecutable
    $tabs = @($restoredState.windows | ForEach-Object { $_.tabs } | Where-Object { $_.kind -eq "document" })
    if ($tabs.Count -ge $restoreFiles.Count -and @($tabs | Where-Object loading).Count -eq 0) { break }
    Start-Sleep -Milliseconds 200
} while ([DateTime]::UtcNow -lt $stateDeadline)
if (-not $restoredState) { throw "再起動後のデバッグ状態APIに接続できませんでした。" }
Write-Output ("OPEN_STATE_AFTER_BUILD=" + ($restoredState | ConvertTo-Json -Depth 8 -Compress))

$activeTab = @($restoredState.windows | ForEach-Object { $_.tabs } | Where-Object active)[0]
if ($activeTab -and $activeTab.path) {
    $expectedTitle = "$(Split-Path -Leaf ([string]$activeTab.path)) - MarkdownViewer"
    $process.Refresh()
    if ($process.MainWindowTitle -ne $expectedTitle) {
        throw "アプリケーションタイトルが一致しません。expected=$expectedTitle actual=$($process.MainWindowTitle)"
    }
    Write-Output "WINDOW_TITLE=$($process.MainWindowTitle)"
}

$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
& $nodePath $analyzer $RemoteDebuggingPort $runDirectory
if ($LASTEXITCODE -ne 0) { throw "実画面解析に失敗しました（終了コード: $LASTEXITCODE）。" }

Write-Output "DEBUG_EXECUTABLE=$debugExecutable"
Write-Output "RESTORED_FILES=$($restoreFiles.Count)"
Write-Output "REPORT=$(Join-Path $runDirectory 'preview-report.json')"
Write-Output "MERMAID_SCREENSHOT=$(Join-Path $runDirectory 'mermaid-popup.png')"
Write-Output "DRAWIO_SCREENSHOT=$(Join-Path $runDirectory 'drawio-popup.png')"
Write-Output "DIFF_CODE_SCREENSHOT=$(Join-Path $runDirectory 'diff-code.png')"
Write-Output "DIFF_RENDERED_SCREENSHOT=$(Join-Path $runDirectory 'diff-rendered.png')"
Write-Output "DIFF_SPLIT_SCREENSHOT=$(Join-Path $runDirectory 'diff-split.png')"

if ($StopAfterTest) {
    Stop-Process -Id $process.Id -Force
    Write-Output "STOPPED_AFTER_TEST_PID=$($process.Id)"
} else {
    Write-Output "DEBUG_APP_LEFT_RUNNING_PID=$($process.Id)"
}
