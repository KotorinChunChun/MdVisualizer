#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet("beta", "stable")]
    [string]$Channel,
    [string]$ConfigPath,
    [switch]$ReleaseIntentConfirmed
)

$arguments = @{ Mode = "Verify"; Channel = $Channel }
if ($PSBoundParameters.ContainsKey("ConfigPath")) { $arguments.ConfigPath = $ConfigPath }
if ($ReleaseIntentConfirmed) { $arguments.ReleaseIntentConfirmed = $true }
& (Join-Path $PSScriptRoot "Invoke-MdVisualizerRelease.ps1") @arguments
$exitCode = 0
$lastExitCodeVariable = Get-Variable -Name LASTEXITCODE -ErrorAction SilentlyContinue
if ($null -ne $lastExitCodeVariable) { $exitCode = [int]$lastExitCodeVariable.Value }
if ($exitCode -ne 0) { exit $exitCode }
