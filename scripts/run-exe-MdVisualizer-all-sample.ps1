[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$TestFile = (Join-Path $PSScriptRoot "..\samples\sample.md"),
    [string]$ExePath,
    [ValidateSet("release", "debug")]
    [string]$Configuration = "release",
    [switch]$Wait
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$resolvedTestFile = (Resolve-Path -LiteralPath $TestFile -ErrorAction Stop).Path
$launcher = Join-Path $PSScriptRoot "run-exe-MdVisualizer-all.ps1"

if (-not $PSCmdlet.ShouldProcess($resolvedTestFile, "サンプル文書を使用してビルド済みMdVisualizerを起動")) {
    return
}

$arguments = @{
    Configuration = $Configuration
    DocumentPath = @($resolvedTestFile)
    Wait = $Wait
    Confirm = $false
}
if (-not [string]::IsNullOrWhiteSpace($ExePath)) {
    $arguments.ExePath = $ExePath
}
& $launcher @arguments
