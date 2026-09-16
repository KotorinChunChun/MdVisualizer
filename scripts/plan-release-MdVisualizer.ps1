#Requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateSet("beta", "stable")]
    [string]$Channel,
    [string]$ConfigPath
)

$arguments = @{ Mode = "Plan" }
if ($PSBoundParameters.ContainsKey("Channel")) { $arguments.Channel = $Channel }
if ($PSBoundParameters.ContainsKey("ConfigPath")) { $arguments.ConfigPath = $ConfigPath }
& (Join-Path $PSScriptRoot "Invoke-MdVisualizerRelease.ps1") @arguments
$exitCode = 0
$lastExitCodeVariable = Get-Variable -Name LASTEXITCODE -ErrorAction SilentlyContinue
if ($null -ne $lastExitCodeVariable) { $exitCode = [int]$lastExitCodeVariable.Value }
if ($exitCode -ne 0) { exit $exitCode }
