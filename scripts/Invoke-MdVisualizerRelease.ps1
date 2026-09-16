#Requires -Version 7.0
# MdVisualizerのリリース工程共通エンジン。
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
Import-Module (Join-Path $PSScriptRoot "MsixSigning.psm1") -Force
Import-Module (Join-Path $PSScriptRoot 'NodeRuntime.psm1') -Force
$configuration = Import-ReleaseConfiguration -Path $ConfigPath -ProjectRoot $projectRoot
$historyVersion = Get-ConfiguredHistoryVersion -Configuration $configuration
Write-Host "Release history version selected from packaging/release-config.json: $historyVersion"
$configuredApplicationVersion = Get-ConfiguredApplicationVersion -Configuration $configuration
if ($Channel -eq "stable" -and (
        [string]$configuration.Raw.application.publicVersion -match "(?i)beta" -or
        $configuredApplicationVersion -match "(?i)(\+|-)beta")) {
    throw "stableリリースを開始できません。packaging/release-config.jsonをstable用Versionへ更新してから実行してください。"
}

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
    $publicVersion = Get-ConfiguredPublicVersion -Configuration $configuration
    $msixVersion = Get-ConfiguredMsixVersion -Configuration $configuration
    Write-Host "Release automation plan (read-only)"
    Write-Host "Application: $($configuration.Raw.application.displayName)"
    Write-Host "Release history version: $historyVersion"
    Write-Host "Public version: $publicVersion"
    Write-Host "Application version: $applicationVersion"
    Write-Host "Package version: $msixVersion"
    Write-Host "Identity: $($configuration.Raw.application.identityName)"
    Write-Host "Publisher: $($configuration.Raw.application.publisher)"
    Write-Host "Certificate: $($configuration.Raw.application.certificateFriendlyName)"
    Write-Host "Signing profile: $(Get-MsixSigningProfilePath)"
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

    # 重いビルドより前に署名設定の不備を検出する。
    $certificate = Get-MsixSigningCertificate -Publisher $configuration.Raw.application.publisher
    $certificate.Dispose()
    Write-Host "Running frontend tests for the explicitly requested release..."
    Push-Location $projectRoot
    try {
        Invoke-MdVisualizerNpm -ProjectRoot $projectRoot -Arguments @('test')
    }
    finally {
        Pop-Location
    }
    Write-Host "Running Rust tests for the explicitly requested release..."
    $runtime = Get-MdVisualizerNodeRuntime -ProjectRoot $projectRoot
    if (-not $runtime.CargoBin) { throw 'Rustの実行環境が見つかりません。' }
    $previousCargoHome = $env:CARGO_HOME
    $previousRustupHome = $env:RUSTUP_HOME
    try {
        $env:CARGO_HOME = $runtime.CargoHome
        $env:RUSTUP_HOME = $runtime.RustupHome
        Invoke-CheckedExternalCommand -FilePath (Join-Path $runtime.CargoBin 'cargo.exe') -ArgumentList @("test") -WorkingDirectory (Join-Path $projectRoot "src-tauri")
    }
    finally {
        $env:CARGO_HOME = $previousCargoHome
        $env:RUSTUP_HOME = $previousRustupHome
    }
    Write-Host "Building and signing the explicitly requested MSIX release..."
    & (Join-Path $PSScriptRoot "package-MdVisualizer-msix.ps1") `
        -ConfigPath $configuration.ConfigPath
    Write-Host "Generating the explicitly requested $SelectedChannel App Installer..."
    & (Join-Path $PSScriptRoot "package-MdVisualizer-appinstaller.ps1") `
        -Channel $SelectedChannel `
        -ConfigPath $configuration.ConfigPath
    & (Join-Path $PSScriptRoot "package-MdVisualizer-portable.ps1") -ReleaseIntentConfirmed
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
    $artifacts = Get-ReleaseArtifacts -Configuration $configuration -Channel $SelectedChannel
    $portableName = "MdVisualizer_$($artifacts.PackageVersion)_x64_portable.zip"
    Copy-Item -LiteralPath (Join-Path $projectRoot "release/$portableName") -Destination (Join-Path $artifacts.Channel.SiteDirectory $portableName) -Force
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
    # 配布ルート全体を送ると他製品の未公開ファイルも公開されるため、製品の正本と成果物に限定する。
    $artifacts = Get-ReleaseArtifacts -Configuration $configuration -Channel $SelectedChannel
    $publishFiles = @(
        Get-ChildItem -LiteralPath $configuration.SiteSourceDirectory -File -Recurse -Force | ForEach-Object {
            $relativePath = [IO.Path]::GetRelativePath($configuration.SiteSourceDirectory, $_.FullName)
            if ($relativePath -ne 'index.html') { Join-Path $configuration.SiteDirectory $relativePath }
        }
        $artifacts.StagedPackagePath
        $artifacts.StagedCertificatePath
        $artifacts.StagedAppInstallerPath
        Join-Path $artifacts.Channel.SiteDirectory "MdVisualizer_$($artifacts.PackageVersion)_x64_portable.zip"
    )
    foreach ($publishFile in $publishFiles) {
        if (!(Test-Path -LiteralPath $publishFile -PathType Leaf)) { throw "公開対象がありません: $publishFile" }
        Invoke-CheckedExternalCommand -FilePath $resolvedPython -ArgumentList @($configuration.FtpUploadScriptPath, "--dry-run", $publishFile) -WorkingDirectory $configuration.WebsiteProjectDirectory
    }
    Write-Host "FTP dry-run passed. Starting explicitly confirmed publication..."
    foreach ($publishFile in $publishFiles) {
        Invoke-CheckedExternalCommand -FilePath $resolvedPython -ArgumentList @($configuration.FtpUploadScriptPath, $publishFile) -WorkingDirectory $configuration.WebsiteProjectDirectory
    }
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
