param(
    [Parameter(Mandatory = $true)]
    [string]$MarkdownPath,
    [string]$ApplicationPath = "$PSScriptRoot\..\src-tauri\target\release\markdown-viewer.exe",
    [string]$OutputDirectory = "C:\tmp\markdownviewer-gui",
    [string]$UiaDumpPath = "C:\tmp\markdownviewer-uia\target\debug\uia_dump.exe",
    [int]$RemoteDebuggingPort = 0
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class InputGuard {
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO {
        public uint cbSize;
        public uint dwTime;
    }
    [DllImport("user32.dll")]
    static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    public static uint LastInputTick() {
        LASTINPUTINFO info = new LASTINPUTINFO();
        info.cbSize = (uint)Marshal.SizeOf(info);
        if (!GetLastInputInfo(ref info)) throw new InvalidOperationException("GetLastInputInfo failed");
        return info.dwTime;
    }
}
"@

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$appPath = (Resolve-Path $ApplicationPath).Path
$documentPath = (Resolve-Path $MarkdownPath).Path
$runDirectory = Join-Path $OutputDirectory (Get-Date -Format "yyyyMMdd-HHmmss")
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null

$previousWebViewArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
if ($RemoteDebuggingPort -gt 0) {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$RemoteDebuggingPort"
}
try {
    $process = Start-Process -FilePath $appPath -ArgumentList @($documentPath) -PassThru
} finally {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousWebViewArguments
}
$deadline = [DateTime]::UtcNow.AddSeconds(20)
do {
    Start-Sleep -Milliseconds 100
    $process.Refresh()
} while ($process.MainWindowHandle -eq 0 -and -not $process.HasExited -and [DateTime]::UtcNow -lt $deadline)

if ($process.HasExited -or $process.MainWindowHandle -eq 0) {
    throw "MarkdownViewerのウィンドウが20秒以内に表示されませんでした。"
}

# Permanent safety rule: once the window appears, observe real user input for
# five seconds and do not send any automated input during this interval.
$baselineInputTick = [InputGuard]::LastInputTick()
$guardDeadline = [DateTime]::UtcNow.AddSeconds(5)
$humanInputDetected = $false
while ([DateTime]::UtcNow -lt $guardDeadline) {
    Start-Sleep -Milliseconds 50
    if ([InputGuard]::LastInputTick() -ne $baselineInputTick) {
        $humanInputDetected = $true
        break
    }
}

if ($humanInputDetected) {
    Write-Output "HUMAN_INPUT_DETECTED pid=$($process.Id)"
    exit 42
}

$screen = [System.Windows.Forms.Screen]::FromHandle($process.MainWindowHandle)
$bounds = $screen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $screenshotPath = Join-Path $runDirectory "screen-before-input.png"
    $bitmap.Save($screenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}

$uiaPath = Join-Path $runDirectory "uia-tree.txt"
& $UiaDumpPath "MarkdownViewer" | Set-Content -LiteralPath $uiaPath -Encoding utf8

Write-Output "SAFE_TO_AUTOMATE pid=$($process.Id)"
Write-Output "SCREENSHOT=$screenshotPath"
Write-Output "UIA_TREE=$uiaPath"
