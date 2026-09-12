[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [string]$CertificateThumbprint,
    [string]$Publisher,
    [string]$TimestampUrl,
    [string]$ConfigPath,
    [switch]$SkipTauriBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$tauriRoot = Join-Path $projectRoot "src-tauri"
Import-Module (Join-Path $PSScriptRoot "ReleaseTools.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "MsixSigning.psm1") -Force
$releaseConfiguration = Import-ReleaseConfiguration -Path $ConfigPath -ProjectRoot $projectRoot
$tauriConfigPath = $releaseConfiguration.TauriConfigPath
$manifestTemplatePath = Join-Path $projectRoot "packaging\msix\AppxManifest.xml.in"
$architecture = $releaseConfiguration.Raw.application.architecture
$identityName = $releaseConfiguration.Raw.application.identityName
$artifactBaseName = $releaseConfiguration.Raw.application.artifactBaseName
$publisherDisplayName = $releaseConfiguration.Raw.application.displayName
$stagingRoot = Join-Path $tauriRoot "target\msix\$architecture\layout"
$releaseExecutable = Join-Path $tauriRoot "target\release\mdvisualizer.exe"

if ([string]::IsNullOrWhiteSpace($Publisher)) {
    $Publisher = $releaseConfiguration.Raw.application.publisher
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = $releaseConfiguration.ReleaseDirectory
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory)]
        [string]$FilePath,
        [Parameter(Mandatory)]
        [string[]]$ArgumentList
    )

    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath"
    }
}

function Resolve-WindowsSdkTool {
    param(
        [Parameter(Mandatory)]
        [string]$ToolName
    )

    $sdkBinRoot = "C:\Program Files (x86)\Windows Kits\10\bin"
    if (-not (Test-Path -LiteralPath $sdkBinRoot)) {
        throw "Windows SDK was not found: $sdkBinRoot"
    }

    $tool = Get-ChildItem -LiteralPath $sdkBinRoot -Directory |
        Where-Object { $_.Name -match "^\d+(\.\d+){3}$" } |
        Sort-Object { [version]$_.Name } -Descending |
        ForEach-Object { Join-Path $_.FullName "x64\$ToolName" } |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1

    if (-not $tool) {
        throw "$ToolName was not found in the x64 Windows SDK tools."
    }

    return $tool
}

function Convert-ToMsixVersion {
    param(
        [Parameter(Mandatory)]
        [string]$Version
    )

    $numericVersion = ($Version -split "-", 2)[0]
    $parts = $numericVersion.Split(".")
    if ($parts.Count -lt 1 -or $parts.Count -gt 4) {
        throw "The application version must contain between one and four numeric parts: $Version"
    }

    $normalized = @()
    foreach ($part in $parts) {
        $number = 0
        if (-not [int]::TryParse($part, [ref]$number) -or $number -lt 0 -or $number -gt 65535) {
            throw "Each MSIX version part must be an integer from 0 through 65535: $Version"
        }
        $normalized += $number
    }

    while ($normalized.Count -lt 4) {
        $normalized += 0
    }

    return $normalized -join "."
}

$tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$packageVersion = Convert-ToMsixVersion -Version $tauriConfig.version
$packageName = "${artifactBaseName}_${packageVersion}_${architecture}"
$outputDirectoryFullPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$msixPath = Join-Path $outputDirectoryFullPath "${packageName}.msix"
$certificatePath = Join-Path $outputDirectoryFullPath $releaseConfiguration.Raw.application.certificateFileName
if ($Publisher -cne $releaseConfiguration.Raw.application.publisher) {
    throw 'Publisherの上書きは使用できません。共通証明書とアプリ設定を一致させてください。'
}
# ビルドや成果物変更の前に共通設定を検証する。秘密鍵の新規発行はしない。
$signingCertificate = Get-MsixSigningCertificate -Publisher $Publisher -CertificateThumbprint $CertificateThumbprint
try {
    New-Item -ItemType Directory -Path $outputDirectoryFullPath -Force | Out-Null
    $certificateBytes = $signingCertificate.Export(
        [System.Security.Cryptography.X509Certificates.X509ContentType]::Cert
    )
    if (Set-FileBytesIfChanged -Path $certificatePath -Bytes $certificateBytes) {
        Write-Host "Updated public certificate: $certificatePath"
    }
    else {
        Write-Host "Reusing unchanged public certificate file: $certificatePath"
    }
    if (-not $SkipTauriBuild) {
        Push-Location $projectRoot
        try {
            Invoke-CheckedCommand -FilePath "npm.cmd" -ArgumentList @(
                "run",
                "tauri",
                "--",
                "build",
                "--no-bundle"
            )
        }
        finally {
            Pop-Location
        }
    }

    if (-not (Test-Path -LiteralPath $releaseExecutable)) {
        throw "Release executable was not found: $releaseExecutable"
    }

    $safeStagingRoot = [System.IO.Path]::GetFullPath($stagingRoot)
    $safeMsixRoot = [System.IO.Path]::GetFullPath((Join-Path $tauriRoot "target\msix"))
    if (-not $safeStagingRoot.StartsWith($safeMsixRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean an unexpected staging directory: $safeStagingRoot"
    }
    if (Test-Path -LiteralPath $safeStagingRoot) {
        Remove-Item -LiteralPath $safeStagingRoot -Recurse -Force
    }

    $assetsDirectory = Join-Path $safeStagingRoot "Assets"
    New-Item -ItemType Directory -Path $assetsDirectory -Force | Out-Null
    Copy-Item -LiteralPath $releaseExecutable -Destination (Join-Path $safeStagingRoot "mdvisualizer.exe")
    foreach ($assetName in (Get-ChildItem -LiteralPath (Join-Path $tauriRoot "icons") -Filter "*.png" -File).Name) {
        Copy-Item `
            -LiteralPath (Join-Path $tauriRoot "icons\$assetName") `
            -Destination (Join-Path $assetsDirectory $assetName)
    }

    $fileTypeAssets = Join-Path $assetsDirectory "filetypes"
    New-Item -ItemType Directory -Path $fileTypeAssets -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $tauriRoot "icons\filetypes") -Filter "*.png" -File |
        Copy-Item -Destination $fileTypeAssets

    $manifest = Get-Content -LiteralPath $manifestTemplatePath -Raw
    $manifest = $manifest.Replace("@@IDENTITY_NAME@@", $identityName)
    $manifest = $manifest.Replace(
        "@@PUBLISHER@@",
        [System.Security.SecurityElement]::Escape($Publisher)
    )
    $manifest = $manifest.Replace("@@PACKAGE_VERSION@@", $packageVersion)
    $manifest = $manifest.Replace("@@ARCHITECTURE@@", $architecture)
    $manifest = $manifest.Replace("@@PUBLISHER_DISPLAY_NAME@@", $publisherDisplayName)
    $manifestPath = Join-Path $safeStagingRoot "AppxManifest.xml"
    [System.IO.File]::WriteAllText(
        $manifestPath,
        $manifest,
        [System.Text.UTF8Encoding]::new($false)
    )

    if (Test-Path -LiteralPath $msixPath) {
        Remove-Item -LiteralPath $msixPath -Force
    }

    $makeAppxPath = Resolve-WindowsSdkTool -ToolName "MakeAppx.exe"
    Invoke-CheckedCommand -FilePath $makeAppxPath -ArgumentList @(
        "pack",
        "/d",
        $safeStagingRoot,
        "/p",
        $msixPath,
        "/o"
    )

    $signToolPath = Resolve-WindowsSdkTool -ToolName "SignTool.exe"
    $signArguments = @(
        "sign",
        "/fd",
        "SHA256"
    )
    $signArguments += @("/s", "My", "/sha1", $signingCertificate.Thumbprint)
    if (-not [string]::IsNullOrWhiteSpace($TimestampUrl)) {
        $signArguments += @("/tr", $TimestampUrl, "/td", "SHA256")
    }
    $signArguments += $msixPath
    Invoke-CheckedCommand -FilePath $signToolPath -ArgumentList $signArguments

    $signature = Get-AuthenticodeSignature -LiteralPath $msixPath
    if (-not $signature.SignerCertificate) {
        throw "The generated MSIX does not contain a signer certificate."
    }
    if ($signature.SignerCertificate.Thumbprint -ne $signingCertificate.Thumbprint) {
        throw "The MSIX signer does not match the selected signing certificate."
    }
    if ($signature.Status -in @("HashMismatch", "NotSigned")) {
        throw "MSIX signature validation failed: $($signature.StatusMessage)"
    }

    Write-Host "MSIX package: $msixPath"
    Write-Host "Public certificate: $certificatePath"
    Write-Host "Signing certificate: $($signingCertificate.Thumbprint) (CurrentUser/My)"
}
finally {
    if ($signingCertificate) {
        $signingCertificate.Dispose()
    }
}
