# =============================================================================
#  リリースビルド版 (exe) 動作テスト用起動スクリプト (run-release-test.ps1)
#  - 処理内容: ビルド済み release バイナリを samples/sample.md を指定して直接起動
#  - 使い方: pwsh c:\develop\MarkdownViewer\dev\scripts\run-release-test.ps1
# =============================================================================
[CmdletBinding()]
param(
    [string]$ExePath,
    [string]$SampleFile,
    [ValidateRange(5, 30)]
    [int]$InputGuardSeconds = 5
)

$ErrorActionPreference = 'Stop'

# スクリプトの存在するディレクトリ（dev/scripts/）から2階層上をプロジェクトルートとする
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\")

if (-not $SampleFile) {
    $SampleFile = Join-Path $ProjectRoot "samples\sample.md"
}

if (-not (Test-Path $SampleFile)) {
    Write-Error "テスト用Markdownファイルが見つかりません: $SampleFile"
    exit 1
}

# ExePathが未指定なら、優先順でリリースビルド済みexeを探す
if (-not $ExePath) {
    $PossiblePaths = @(
        (Join-Path $ProjectRoot "src-tauri\target\release\markdown-viewer.exe"),
        (Join-Path $ProjectRoot "src-tauri\target\release\MarkdownViewer.exe")
    )

    foreach ($PossiblePath in $PossiblePaths) {
        if (Test-Path $PossiblePath) {
            $ExePath = $PossiblePath
            break
        }
    }
}

if (-not $ExePath -or -not (Test-Path $ExePath)) {
    Write-Host "リリースビルド (.exe) が見つかりませんでした。" -ForegroundColor Yellow
    Write-Host "先に `release-MarkdownViewer.ps1` または `npm run tauri build` でビルドを実行してください。" -ForegroundColor Yellow
    exit 1
}

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " リリース版 (.exe) テスト起動スクリプト" -ForegroundColor Cyan
Write-Host " 実行ファイル: $ExePath" -ForegroundColor Green
Write-Host " 対象ファイル: $SampleFile" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class MarkdownViewerInputGuard
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO info);

    public static uint GetLastInputTick()
    {
        var info = new LASTINPUTINFO();
        info.cbSize = (uint)Marshal.SizeOf(info);
        if (!GetLastInputInfo(ref info))
        {
            throw new InvalidOperationException("GetLastInputInfo failed.");
        }

        return info.dwTime;
    }
}
'@

$ApplicationProcess = Start-Process -FilePath $ExePath -ArgumentList "`"$SampleFile`"" -PassThru
$WindowDeadline = [DateTime]::UtcNow.AddSeconds(30)

do {
    Start-Sleep -Milliseconds 100
    $ApplicationProcess.Refresh()
    if ($ApplicationProcess.HasExited) {
        Write-Error "MarkdownViewerがウィンドウ表示前に終了しました。"
        exit 1
    }
} while ($ApplicationProcess.MainWindowHandle -eq 0 -and [DateTime]::UtcNow -lt $WindowDeadline)

if ($ApplicationProcess.MainWindowHandle -eq 0) {
    Write-Error "MarkdownViewerのウィンドウ表示を30秒以内に確認できませんでした。"
    exit 1
}

Write-Host "ウィンドウ表示を確認しました。${InputGuardSeconds}秒間、人間の入力を監視します。" -ForegroundColor Yellow
$InitialInputTick = [MarkdownViewerInputGuard]::GetLastInputTick()
$GuardStopwatch = [Diagnostics.Stopwatch]::StartNew()

while ($GuardStopwatch.Elapsed.TotalSeconds -lt $InputGuardSeconds) {
    Start-Sleep -Milliseconds 100
    if ([MarkdownViewerInputGuard]::GetLastInputTick() -ne $InitialInputTick) {
        Write-Warning "人間のマウスまたはキーボード入力を検知したため、自動操作を中止します。"
        Write-Output "GUI_INPUT_GUARD_ABORTED"
        exit 2
    }
}

Write-Host "入力監視を通過しました。GUI自動操作を開始できます。" -ForegroundColor Green
Write-Output "GUI_INPUT_GUARD_PASSED processId=$($ApplicationProcess.Id) windowHandle=$($ApplicationProcess.MainWindowHandle)"
