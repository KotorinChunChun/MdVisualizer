[CmdletBinding(SupportsShouldProcess)]
param(
    [string[]]$DocumentPath = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Import-Module (Join-Path $PSScriptRoot 'NodeRuntime.psm1') -Force
$resolvedDocuments = @($DocumentPath | ForEach-Object {
    (Resolve-Path -LiteralPath $_ -ErrorAction Stop).Path
})
$targetDescription = if ($resolvedDocuments.Count -gt 0) {
    "全機能 / 文書: $($resolvedDocuments -join ', ')"
} else {
    "全機能"
}

if (-not $PSCmdlet.ShouldProcess($targetDescription, "MdVisualizerをデバッグビルドして起動")) {
    return
}

$npmArguments = @("run", "tauri", "--", "dev")
if ($resolvedDocuments.Count -gt 0) {
    $npmArguments += @("--", "--")
    $npmArguments += $resolvedDocuments
}

Push-Location $projectRoot
try {
    Invoke-MdVisualizerNpm -ProjectRoot $projectRoot -Arguments $npmArguments
} finally {
    Pop-Location
}
