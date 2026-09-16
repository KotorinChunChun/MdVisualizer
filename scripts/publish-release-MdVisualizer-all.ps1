#Requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateSet("Plan", "Build", "Stage", "Publish", "Verify", "Full")]
    [string]$Mode = "Plan",
    [ValidateSet("beta", "stable")]
    [string]$Channel,
    [string]$ConfigPath,
    [string]$PythonPath,
    [switch]$ReleaseIntentConfirmed,
    [switch]$PublishConfirmed
)

# 既存名称を維持する互換入口。リリース共通処理はInvoke-MdVisualizerRelease.ps1に集約する。
$commonScript = Join-Path $PSScriptRoot "Invoke-MdVisualizerRelease.ps1"
$forwardedArguments = @{ Mode = $Mode }
if ($PSBoundParameters.ContainsKey("Channel")) { $forwardedArguments.Channel = $Channel }
if ($PSBoundParameters.ContainsKey("ConfigPath")) { $forwardedArguments.ConfigPath = $ConfigPath }
if ($PSBoundParameters.ContainsKey("PythonPath")) { $forwardedArguments.PythonPath = $PythonPath }
if ($ReleaseIntentConfirmed) { $forwardedArguments.ReleaseIntentConfirmed = $true }
if ($PublishConfirmed) { $forwardedArguments.PublishConfirmed = $true }
& $commonScript @forwardedArguments
$exitCode = 0
$lastExitCodeVariable = Get-Variable -Name LASTEXITCODE -ErrorAction SilentlyContinue
if ($null -ne $lastExitCodeVariable) { $exitCode = [int]$lastExitCodeVariable.Value }
if ($exitCode -ne 0) { exit $exitCode }
