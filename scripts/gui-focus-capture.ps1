param(
    [string]$OutputDirectory = "C:\tmp\markdownviewer-gui",
    [string]$UiaFocusPath = "C:\tmp\markdownviewer-uia\target\debug\uia_focus.exe"
)

$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class GuiCaptureNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string title);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
    public static uint LastInputTick() {
        LASTINPUTINFO info = new LASTINPUTINFO();
        info.cbSize = (uint)Marshal.SizeOf(info);
        if (!GetLastInputInfo(ref info)) throw new InvalidOperationException("GetLastInputInfo failed");
        return info.dwTime;
    }
}
"@
Add-Type -AssemblyName System.Drawing

$baseline = [GuiCaptureNative]::LastInputTick()
$deadline = [DateTime]::UtcNow.AddSeconds(5)
while ([DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 50
    if ([GuiCaptureNative]::LastInputTick() -ne $baseline) {
        Write-Output "HUMAN_INPUT_DETECTED"
        exit 42
    }
}

$window = [GuiCaptureNative]::FindWindow("Tauri Window", "MarkdownViewer")
if ($window -eq [IntPtr]::Zero) { throw "MarkdownViewer window not found." }
[GuiCaptureNative]::ShowWindow($window, 9) | Out-Null
& $UiaFocusPath "MarkdownViewer" | Out-Null
[GuiCaptureNative]::SetForegroundWindow($window) | Out-Null
Start-Sleep -Milliseconds 500

$rect = New-Object GuiCaptureNative+RECT
if (-not [GuiCaptureNative]::GetWindowRect($window, [ref]$rect)) { throw "GetWindowRect failed." }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$runDirectory = Join-Path $OutputDirectory (Get-Date -Format "yyyyMMdd-HHmmss")
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
$screenshot = Join-Path $runDirectory "markdownviewer.png"
try {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($screenshot, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
Write-Output "SAFE_CAPTURE=$screenshot"
Write-Output "WINDOW_RECT=$($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)"
