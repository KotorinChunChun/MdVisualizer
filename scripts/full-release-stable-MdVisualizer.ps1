#Requires -Version 7.0
[CmdletBinding()]
param()

# 正式リリース時に使用するstable専用の一括入口。stable公開はこの入口だけから行う。
$arguments = @{
    Mode = "Full"
    Channel = "stable"
    ReleaseIntentConfirmed = $true
    PublishConfirmed = $true
}
& (Join-Path $PSScriptRoot "Invoke-MdVisualizerRelease.ps1") @arguments
$exitCode = 0
$lastExitCodeVariable = Get-Variable -Name LASTEXITCODE -ErrorAction SilentlyContinue
if ($null -ne $lastExitCodeVariable) { $exitCode = [int]$lastExitCodeVariable.Value }
if ($exitCode -ne 0) { exit $exitCode }
