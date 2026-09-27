#Requires -Version 7.0
[CmdletBinding()]
param()

$arguments = @{ Mode = "Publish"; Channel = "beta"; ReleaseIntentConfirmed = $true; PublishConfirmed = $true }
& (Join-Path $PSScriptRoot "Invoke-MdVisualizerRelease.ps1") @arguments
$exitCode = 0
$lastExitCodeVariable = Get-Variable -Name LASTEXITCODE -ErrorAction SilentlyContinue
if ($null -ne $lastExitCodeVariable) { $exitCode = [int]$lastExitCodeVariable.Value }
if ($exitCode -ne 0) { exit $exitCode }
