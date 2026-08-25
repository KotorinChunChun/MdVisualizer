# MarkdownViewerのガード付き公開エントリポイント。
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

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot "ReleaseTools.psm1") -Force
$configuration = Import-ReleaseConfiguration -Path $ConfigPath -ProjectRoot $projectRoot

$releaseModes = @("Build", "Stage", "Publish", "Full")
if ($Mode -in $releaseModes -and -not $ReleaseIntentConfirmed) {
    throw "Mode $Mode is blocked. Run it only after the user explicitly requests the release operation, then pass -ReleaseIntentConfirmed."
}
if ($Mode -in @("Publish", "Full") -and -not $PublishConfirmed) {
    throw "Mode $Mode is blocked from FTP publication. Pass -PublishConfirmed only after the user explicitly requests publication."
}
if ($Mode -ne "Plan" -and [string]::IsNullOrWhiteSpace($Channel)) {
    throw "Channel is required for Mode $Mode. Specify beta or stable explicitly."
}

function Invoke-CheckedExternalCommand {
    param(
        [Parameter(Mandatory)]
        [string]$FilePath,
        [Parameter(Mandatory)]
        [string[]]$ArgumentList,
        [Parameter(Mandatory)]
        [string]$WorkingDirectory
    )

    Push-Location $WorkingDirectory
    try {
        & $FilePath @ArgumentList
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code ${LASTEXITCODE}: $FilePath"
        }
    }
    finally {
        Pop-Location
    }
}

function Resolve-PythonExecutable {
    if (-not [string]::IsNullOrWhiteSpace($PythonPath)) {
        $resolvedPython = [System.IO.Path]::GetFullPath($PythonPath)
        if (-not (Test-Path -LiteralPath $resolvedPython -PathType Leaf)) {
            throw "Python executable was not found: $resolvedPython"
        }
        return $resolvedPython
    }

    $pythonCommand = Get-Command "python" -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($pythonCommand) {
        return $pythonCommand.Source
    }

    throw "PythonPath is required for FTP publication because no python executable was found on PATH."
}

function Show-ReleasePlan {
    $applicationVersion = Get-ConfiguredApplicationVersion -Configuration $configuration
    Write-Host "Release automation plan (read-only)"
    Write-Host "Application: $($configuration.Raw.application.displayName)"
    Write-Host "Application version: $applicationVersion"
    Write-Host "Package version: $(ConvertTo-MsixVersion -Version $applicationVersion)"
    Write-Host "Identity: $($configuration.Raw.application.identityName)"
    Write-Host "Publisher: $($configuration.Raw.application.publisher)"
    Write-Host "Certificate: $($configuration.Raw.application.certificateFriendlyName)"
    Write-Host "Site directory: $($configuration.SiteDirectory)"
    foreach ($channelName in @("beta", "stable")) {
        $plannedArtifacts = Get-ReleaseArtifacts `
            -Configuration $configuration `
            -Channel $channelName `
            -ApplicationVersion $applicationVersion
        Write-Host "[$channelName] App Installer: $($plannedArtifacts.AppInstallerUri)"
        Write-Host "[$channelName] MSIX: $($plannedArtifacts.PackageUri)"
    }
    Write-Host "NO BUILD, INSTALLER GENERATION, STAGING, UPLOAD, OR INSTALLATION WAS STARTED."
}

function Invoke-BuildRelease {
    param(
        [Parameter(Mandatory)]
        [ValidateSet("beta", "stable")]
        [string]$SelectedChannel
    )

    Write-Host "Running frontend tests for the explicitly requested release..."
    Invoke-CheckedExternalCommand -FilePath "npm.cmd" -ArgumentList @("test") -WorkingDirectory $projectRoot
    Write-Host "Running Rust tests for the explicitly requested release..."
    Invoke-CheckedExternalCommand -FilePath "cargo" -ArgumentList @("test") -WorkingDirectory (Join-Path $projectRoot "src-tauri")
    Write-Host "Building and signing the explicitly requested MSIX release..."
    & (Join-Path $PSScriptRoot "build-msix.ps1") `
        -ConfigPath $configuration.ConfigPath
    Write-Host "Generating the explicitly requested $SelectedChannel App Installer..."
    & (Join-Path $PSScriptRoot "build-appinstaller.ps1") `
        -Channel $SelectedChannel `
        -ConfigPath $configuration.ConfigPath
}

function Invoke-StageRelease {
    param(
        [Parameter(Mandatory)]
        [ValidateSet("beta", "stable")]
        [string]$SelectedChannel
    )

    & (Join-Path $PSScriptRoot "stage-msix-release.ps1") `
        -Channel $SelectedChannel `
        -ConfigPath $configuration.ConfigPath
    & (Join-Path $PSScriptRoot "verify-msix-release.ps1") `
        -Channel $SelectedChannel `
        -ConfigPath $configuration.ConfigPath
}

function Invoke-PublishRelease {
    param(
        [Parameter(Mandatory)]
        [ValidateSet("beta", "stable")]
        [string]$SelectedChannel
    )

    if (-not (Test-Path -LiteralPath $configuration.FtpUploadScriptPath -PathType Leaf)) {
        throw "FTP upload script was not found: $($configuration.FtpUploadScriptPath)"
    }
    $resolvedPython = Resolve-PythonExecutable

    & (Join-Path $PSScriptRoot "verify-msix-release.ps1") `
        -Channel $SelectedChannel `
        -ConfigPath $configuration.ConfigPath
    Invoke-CheckedExternalCommand `
        -FilePath $resolvedPython `
        -ArgumentList @($configuration.FtpUploadScriptPath, "--dry-run", $configuration.SiteDirectory) `
        -WorkingDirectory $configuration.WebsiteProjectDirectory
    Write-Host "FTP dry-run passed. Starting explicitly confirmed publication..."
    Invoke-CheckedExternalCommand `
        -FilePath $resolvedPython `
        -ArgumentList @($configuration.FtpUploadScriptPath, $configuration.SiteDirectory) `
        -WorkingDirectory $configuration.WebsiteProjectDirectory
    & (Join-Path $PSScriptRoot "verify-published-msix-release.ps1") `
        -Channel $SelectedChannel `
        -ConfigPath $configuration.ConfigPath
}

switch ($Mode) {
    "Plan" {
        Show-ReleasePlan
    }
    "Build" {
        Invoke-BuildRelease -SelectedChannel $Channel
    }
    "Stage" {
        Invoke-StageRelease -SelectedChannel $Channel
    }
    "Publish" {
        Invoke-PublishRelease -SelectedChannel $Channel
    }
    "Verify" {
        & (Join-Path $PSScriptRoot "verify-msix-release.ps1") `
            -Channel $Channel `
            -ConfigPath $configuration.ConfigPath
        & (Join-Path $PSScriptRoot "verify-published-msix-release.ps1") `
            -Channel $Channel `
            -ConfigPath $configuration.ConfigPath
    }
    "Full" {
        Invoke-BuildRelease -SelectedChannel $Channel
        Invoke-StageRelease -SelectedChannel $Channel
        Invoke-PublishRelease -SelectedChannel $Channel
    }
}
