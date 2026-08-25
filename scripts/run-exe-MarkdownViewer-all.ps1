[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$ExePath,
    [ValidateSet("release", "debug")]
    [string]$Configuration = "release",
    [string[]]$DocumentPath = @(),
    [switch]$Wait
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($ExePath)) {
    $ExePath = Join-Path $projectRoot "src-tauri\target\$Configuration\markdown-viewer.exe"
}
$resolvedExePath = [IO.Path]::GetFullPath($ExePath)
$resolvedDocuments = @($DocumentPath | ForEach-Object {
    (Resolve-Path -LiteralPath $_ -ErrorAction Stop).Path
})
$processArguments = @($resolvedDocuments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' })
$targetDescription = if ($resolvedDocuments.Count -gt 0) {
    "$resolvedExePath / 文書: $($resolvedDocuments -join ', ')"
} else {
    $resolvedExePath
}

if (-not $PSCmdlet.ShouldProcess($targetDescription, "ビルド済みMarkdownViewerを起動")) {
    return
}
if (-not (Test-Path -LiteralPath $resolvedExePath -PathType Leaf)) {
    throw "ビルド済みMarkdownViewerが見つかりません: $resolvedExePath"
}

$startArguments = @{
    FilePath = $resolvedExePath
    PassThru = $true
}
if ($processArguments.Count -gt 0) {
    $startArguments.ArgumentList = $processArguments
}
$process = Start-Process @startArguments
Write-Output "MARKDOWNVIEWER_PROCESS_ID=$($process.Id)"
Write-Output "MARKDOWNVIEWER_EXECUTABLE=$resolvedExePath"
if ($Wait) {
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "MarkdownViewerが終了コード $($process.ExitCode) で終了しました。"
    }
}
