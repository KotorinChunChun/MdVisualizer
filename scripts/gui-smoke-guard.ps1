param(
    [Parameter(Mandatory = $true)]
    [string]$MarkdownPath,
    [string]$ApplicationPath = "$PSScriptRoot\..\src-tauri\target\release\mdvisualizer.exe",
    [string]$OutputDirectory,
    [string]$TargetVersion = $env:MDVISUALIZER_VERSION,
    [string]$UiaDumpPath = "C:\tmp\mdvisualizer-uia\target\debug\uia_dump.exe",
    [int]$RemoteDebuggingPort = 0
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot 'VersionLogPath.psm1') -Force
$logProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resolvedLogDirectory = Get-VersionLogDirectory -ProjectRoot $logProjectRoot -Scenario 'gui-smoke' -TargetVersion $TargetVersion -OutputDirectory $OutputDirectory

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$appPath = (Resolve-Path $ApplicationPath).Path
$documentPath = (Resolve-Path $MarkdownPath).Path
$runDirectory = $resolvedLogDirectory
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
    throw "MdVisualizerのウィンドウが20秒以内に表示されませんでした。"
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
& $UiaDumpPath "MdVisualizer" | Set-Content -LiteralPath $uiaPath -Encoding utf8

Write-Output "READY_TO_AUTOMATE pid=$($process.Id)"
Write-Output "SCREENSHOT=$screenshotPath"
Write-Output "UIA_TREE=$uiaPath"
