[CmdletBinding()]
param(
    [string[]]$FallbackMarkdownPaths = @("$PSScriptRoot\..\samples\v0.0.10-editing.md"),
    [string]$OutputDirectory,
    [string]$TargetVersion = $env:MDVISUALIZER_VERSION,
    [int]$RemoteDebuggingPort = 9333,
    [switch]$AllSamples,
    [switch]$SkipBuild,
    [switch]$StopAfterTest,
    [string[]]$Scenario = @(),
    [string[]]$ChangedPath = @(),
    [switch]$PlanOnly,
    [switch]$AttachOnly
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot 'VersionLogPath.psm1') -Force
$logProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resolvedLogDirectory = Get-VersionLogDirectory -ProjectRoot $logProjectRoot -Scenario 'debug-smoke' -TargetVersion $TargetVersion -OutputDirectory $OutputDirectory
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Import-Module (Join-Path $PSScriptRoot 'NodeRuntime.psm1') -Force
$debugExecutable = Join-Path $projectRoot "src-tauri\target\debug\mdvisualizer.exe"
$analyzer = Join-Path $PSScriptRoot "debug-preview-smoke.mjs"
$sampleAnalyzer = Join-Path $PSScriptRoot "debug-sample-suite.mjs"
$runDirectory = $resolvedLogDirectory
if ([string]::IsNullOrWhiteSpace($TargetVersion)) { throw '対象版を-TargetVersionまたはMDVISUALIZER_VERSIONで指定してください。' }
if ($AllSamples -and ($Scenario.Count -gt 0 -or $ChangedPath.Count -gt 0)) { throw '-AllSamplesと部分選択は同時に使えません。' }
if ($AttachOnly -and $AllSamples) { throw '-AttachOnlyでは既存サンプルの再投入を行いません。' }
if ($AttachOnly -and $StopAfterTest) { throw '-AttachOnlyで既存プロセスを停止できません。' }
$runtime = Get-MdVisualizerNodeRuntime -ProjectRoot $projectRoot
$analyzerArguments = @($RemoteDebuggingPort, $runDirectory, '--version', $TargetVersion)
foreach ($id in $Scenario) { $analyzerArguments += @('--scenario', $id) }
foreach ($file in $ChangedPath) { $analyzerArguments += @('--changed', $file) }
$previousConsoleEncoding = [Console]::OutputEncoding
try {
    # NodeのUTF-8 JSONをWindowsの既定コードページで壊さない。
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    $planJson = & $runtime.NodeExecutable $analyzer @analyzerArguments --plan-only
    $planExitCode = $LASTEXITCODE
} finally { [Console]::OutputEncoding = $previousConsoleEncoding }
if ($planExitCode -ne 0) { $planJson; throw '検証対象を判定できません。PlanのreviewRequiredを確認し、対象シナリオを明示してください。' }
if ($PlanOnly) {
    try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $planJson }
    finally { [Console]::OutputEncoding = $previousConsoleEncoding }
    return
}
$plan = ($planJson -join "`n") | ConvertFrom-Json
$needsWebView = @($plan.steps | Where-Object { $_.status -ne 'excluded' -and $_.kind -ne 'manual' }).Count -gt 0
if ($AttachOnly -or -not $needsWebView) {
    # 部分検証の推奨入口。既存アプリの探索・停止・ビルド・起動を行わない。
    & $runtime.NodeExecutable $analyzer @analyzerArguments
    if ($LASTEXITCODE -eq 2) { Write-Output 'MANUAL_CHECKS_PENDING=gui-summary.jsonの手動工程を個別に観測してください。'; return }
    if ($LASTEXITCODE -ne 0) { throw '個別GUI検証に失敗しました。gui-summary.jsonを確認してください。' }
    return
}
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null

function Get-MdVisualizerProcesses {
    @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -in @("mdvisualizer", "MdVisualizer") -and $_.Path
    })
}

function Get-DebugApplicationState([string]$ExecutablePath, [int]$TimeoutMilliseconds = 3000) {
    $responsePath = Join-Path ([IO.Path]::GetTempPath()) "mdvisualizer-debug-state-$([guid]::NewGuid().ToString('N')).json"
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
        throw "MdVisualizerのウィンドウが$TimeoutSeconds秒以内に表示されませんでした。"
    }
}

$running = Get-MdVisualizerProcesses
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

$base64Fixture = $null
$pngFixture = $null
if ($AllSamples) {
    $samplesDirectory = (Resolve-Path (Join-Path $projectRoot "samples")).Path
    Get-ChildItem -LiteralPath $samplesDirectory -Recurse -File | Where-Object {
        $_.Extension.ToLowerInvariant() -in @(".md", ".markdown", ".svg", ".mmd", ".mermaid", ".drawio")
    } | Sort-Object FullName | ForEach-Object {
        if (-not $restoreFiles.Contains($_.FullName)) { $restoreFiles.Add($_.FullName) }
    }
    $base64Fixture = Join-Path $runDirectory "clipboard-base64-smoke.md"
    $pngFixture = Join-Path $runDirectory "clipboard-png-smoke.md"
    [IO.File]::WriteAllText($base64Fixture, "# Base64 clipboard smoke`r`n`r`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($pngFixture, "# PNG clipboard smoke`r`n`r`n", [Text.UTF8Encoding]::new($false))
    $restoreFiles.Add($base64Fixture)
    $restoreFiles.Add($pngFixture)
}

if (-not $SkipBuild) {
    $previousDebugApi = $env:VITE_MDVISUALIZER_DEBUG_API
    $env:VITE_MDVISUALIZER_DEBUG_API = "1"
    try {
        Push-Location $projectRoot
        try {
            Invoke-MdVisualizerNpm -ProjectRoot $projectRoot -Arguments @('run', 'tauri', '--', 'build', '--debug', '--no-bundle')
        } finally {
            Pop-Location
        }
    } finally {
        $env:VITE_MDVISUALIZER_DEBUG_API = $previousDebugApi
    }
}
if (-not (Test-Path -LiteralPath $debugExecutable)) { throw "デバッグ実行ファイルがありません: $debugExecutable" }

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
Write-Output "READY_TO_ANALYZE pid=$($process.Id)"

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
if ($AllSamples) {
    $failedTabs = @($restoredState.windows | ForEach-Object { $_.tabs } | Where-Object { $_.loading -or $_.error })
    if ($failedTabs.Count -gt 0) {
        throw "サンプルタブの読込に失敗しました: $($failedTabs | ConvertTo-Json -Depth 5 -Compress)"
    }
}

$activeTab = @($restoredState.windows | ForEach-Object { $_.tabs } | Where-Object active)[0]
if ($activeTab -and $activeTab.path) {
    $expectedTitle = "$(Split-Path -Leaf ([string]$activeTab.path)) - MdVisualizer"
    $process.Refresh()
    if ($process.MainWindowTitle -ne $expectedTitle) {
        throw "アプリケーションタイトルが一致しません。expected=$expectedTitle actual=$($process.MainWindowTitle)"
    }
    Write-Output "WINDOW_TITLE=$($process.MainWindowTitle)"
}

$nodePath = $runtime.NodeExecutable
& $nodePath $analyzer @analyzerArguments
if ($LASTEXITCODE -ne 0) {
    if ($StopAfterTest -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    throw "実画面解析に失敗しました（終了コード: $LASTEXITCODE）。"
}
if ($AllSamples) {
    & $nodePath $sampleAnalyzer $RemoteDebuggingPort $runDirectory $samplesDirectory $base64Fixture $pngFixture
    if ($LASTEXITCODE -ne 0) {
        if ($StopAfterTest -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
        throw "全サンプル実画面解析に失敗しました（終了コード: $LASTEXITCODE）。"
    }
    Write-Output "SAMPLE_SUITE_REPORT=$(Join-Path $runDirectory 'sample-suite-report.json')"
}

Write-Output "DEBUG_EXECUTABLE=$debugExecutable"
Write-Output "RESTORED_FILES=$($restoreFiles.Count)"
Write-Output "REPORT=$(Join-Path $runDirectory 'preview-report.json')"
Write-Output "GUI_SUMMARY=$(Join-Path $runDirectory 'gui-summary.json')"
Write-Output "STRUCTURED_LIST_SCREENSHOT=$(Join-Path $runDirectory 'structured-list.png')"
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
