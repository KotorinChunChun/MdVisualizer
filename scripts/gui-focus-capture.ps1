param(
    [string]$OutputDirectory,
    [string]$TargetVersion = $env:MDVISUALIZER_VERSION,
    [string]$UiaFocusPath = "C:\tmp\mdvisualizer-uia\target\debug\uia_focus.exe"
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot 'VersionLogPath.psm1') -Force
$logProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resolvedLogDirectory = Get-VersionLogDirectory -ProjectRoot $logProjectRoot -Scenario 'gui-focus' -TargetVersion $TargetVersion -OutputDirectory $OutputDirectory
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class GuiCaptureNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string title);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
}
"@
Add-Type -AssemblyName System.Drawing

$window = [GuiCaptureNative]::FindWindow("Tauri Window", "MdVisualizer")
if ($window -eq [IntPtr]::Zero) { throw "MdVisualizer window not found." }
[GuiCaptureNative]::ShowWindow($window, 9) | Out-Null
& $UiaFocusPath "MdVisualizer" | Out-Null
[GuiCaptureNative]::SetForegroundWindow($window) | Out-Null
Start-Sleep -Milliseconds 500

$rect = New-Object GuiCaptureNative+RECT
if (-not [GuiCaptureNative]::GetWindowRect($window, [ref]$rect)) { throw "GetWindowRect failed." }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$runDirectory = $resolvedLogDirectory
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
$screenshot = Join-Path $runDirectory "mdvisualizer.png"
try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($screenshot, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
Write-Output "SAFE_CAPTURE=$screenshot"
Write-Output "WINDOW_RECT=$($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)"
