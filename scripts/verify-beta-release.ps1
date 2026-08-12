[CmdletBinding()]
param(
    [string]$SiteDirectory,
    [string]$ConfigPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$arguments = @{
    Channel = "beta"
}
if (-not [string]::IsNullOrWhiteSpace($SiteDirectory)) {
    $arguments.SiteDirectory = $SiteDirectory
}
if (-not [string]::IsNullOrWhiteSpace($ConfigPath)) {
    $arguments.ConfigPath = $ConfigPath
}

& (Join-Path $PSScriptRoot "verify-msix-release.ps1") @arguments
