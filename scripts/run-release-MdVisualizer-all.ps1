[CmdletBinding(SupportsShouldProcess)]
param(
    [string[]]$DocumentPath = @(),
    [switch]$Wait
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Import-Module (Join-Path $PSScriptRoot 'NodeRuntime.psm1') -Force
$resolvedDocuments = @($DocumentPath | ForEach-Object {
    (Resolve-Path -LiteralPath $_ -ErrorAction Stop).Path
})

if (-not $PSCmdlet.ShouldProcess("MdVisualizer 全機能", "リリースビルドして起動")) {
    return
}

Push-Location $projectRoot
try {
    Invoke-MdVisualizerNpm -ProjectRoot $projectRoot -Arguments @('run', 'tauri', '--', 'build', '--no-bundle')
} finally {
    Pop-Location
}

& (Join-Path $PSScriptRoot "run-exe-MdVisualizer-all.ps1") `
    -Configuration release `
    -DocumentPath $resolvedDocuments `
    -Wait:$Wait `
    -Confirm:$false
