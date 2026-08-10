[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet("beta", "stable")]
    [string]$Channel,
    [string]$ConfigPath,
    [string]$SiteDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot "ReleaseTools.psm1") -Force
$configuration = Import-ReleaseConfiguration -Path $ConfigPath -ProjectRoot $projectRoot
$artifacts = Get-ReleaseArtifacts -Configuration $configuration -Channel $Channel

if ([string]::IsNullOrWhiteSpace($SiteDirectory)) {
    $SiteDirectory = $configuration.SiteDirectory
}
$siteRoot = [System.IO.Path]::GetFullPath($SiteDirectory)
if (-not $siteRoot.Equals($configuration.SiteDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to verify a directory that differs from release configuration: $siteRoot"
}

if (-not (Test-Path -LiteralPath $configuration.SiteSourceDirectory -PathType Container)) {
    throw "Site source directory was not found: $($configuration.SiteSourceDirectory)"
}
foreach ($sourceFile in Get-ChildItem -LiteralPath $configuration.SiteSourceDirectory -File -Recurse -Force) {
    $relativePath = [System.IO.Path]::GetRelativePath(
        $configuration.SiteSourceDirectory,
        $sourceFile.FullName
    )
    $stagedPath = Join-Path $siteRoot $relativePath
    if (-not (Test-Path -LiteralPath $stagedPath -PathType Leaf)) {
        throw "Required staged site file is missing: $stagedPath"
    }
    if ((Get-Item -LiteralPath $stagedPath).Length -eq 0) {
        throw "Required staged site file is empty: $stagedPath"
    }
}

foreach ($artifactPath in @(
    $artifacts.StagedPackagePath,
    $artifacts.StagedCertificatePath,
    $artifacts.StagedAppInstallerPath
)) {
    if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
        throw "Required staged $Channel artifact is missing: $artifactPath"
    }
    if ((Get-Item -LiteralPath $artifactPath).Length -eq 0) {
        throw "Required staged $Channel artifact is empty: $artifactPath"
    }
}

$htmlFiles = Get-ChildItem -LiteralPath $siteRoot -Filter "*.html" -File -Recurse
foreach ($htmlPath in $htmlFiles) {
    $html = Get-Content -LiteralPath $htmlPath.FullName -Raw
    if ($html -notmatch '<html\s+lang="ja"' -or $html -notmatch '<meta\s+name="viewport"') {
        throw "Required language or viewport metadata is missing: $($htmlPath.FullName)"
    }
    if ([regex]::Matches($html, '<h1(?:\s[^>]*)?>').Count -ne 1) {
        throw "Each page must contain exactly one h1: $($htmlPath.FullName)"
    }

    foreach ($match in [regex]::Matches($html, '(?:href|src)="([^"]+)"')) {
        $reference = $match.Groups[1].Value
        if (
            $reference.StartsWith("https://") -or
            $reference.StartsWith("http://") -or
            $reference.StartsWith("#") -or
            $reference.StartsWith("mailto:")
        ) {
            continue
        }

        $referenceWithoutFragment = ($reference -split '[?#]', 2)[0]
        if ([string]::IsNullOrWhiteSpace($referenceWithoutFragment)) {
            continue
        }

        $resolvedReference = [System.IO.Path]::GetFullPath(
            (Join-Path $htmlPath.DirectoryName $referenceWithoutFragment)
        )
        if (-not $resolvedReference.StartsWith($siteRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Local reference escapes the site root: $($htmlPath.FullName) -> $reference"
        }
        if (Test-Path -LiteralPath $resolvedReference -PathType Container) {
            $resolvedReference = Join-Path $resolvedReference "index.html"
        }
        if (-not (Test-Path -LiteralPath $resolvedReference -PathType Leaf)) {
            throw "Broken local reference: $($htmlPath.FullName) -> $reference"
        }
    }
}

$htaccessPath = Join-Path $siteRoot ".htaccess"
if (-not (Test-Path -LiteralPath $htaccessPath -PathType Leaf)) {
    throw "The staged site does not contain .htaccess."
}
$htaccess = Get-Content -LiteralPath $htaccessPath -Raw
foreach ($mimeMapping in @("application/msix .msix", "application/appinstaller .appinstaller")) {
    if (-not $htaccess.Contains($mimeMapping)) {
        throw "Required MIME mapping is missing from .htaccess: $mimeMapping"
    }
}

$identity = Get-MsixIdentity -PackagePath $artifacts.StagedPackagePath
Assert-MsixIdentityMatchesConfiguration `
    -Identity $identity `
    -Configuration $configuration `
    -ExpectedVersion $artifacts.PackageVersion

$signature = Get-AuthenticodeSignature -LiteralPath $artifacts.StagedPackagePath
if (-not $signature.SignerCertificate) {
    throw "The staged $Channel MSIX does not contain a signer certificate."
}
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
    $artifacts.StagedCertificatePath
)
try {
    if ($certificate.Thumbprint -ne $signature.SignerCertificate.Thumbprint) {
        throw "The staged $Channel CER does not match the MSIX signer."
    }
}
finally {
    $certificate.Dispose()
}

[xml]$appInstaller = Get-Content -LiteralPath $artifacts.StagedAppInstallerPath -Raw
$rootNode = $appInstaller.SelectSingleNode("/*[local-name()='AppInstaller']")
$mainPackage = $appInstaller.SelectSingleNode(
    "/*[local-name()='AppInstaller']/*[local-name()='MainPackage']"
)
$onLaunch = $appInstaller.SelectSingleNode(
    "/*[local-name()='AppInstaller']/*[local-name()='UpdateSettings']/*[local-name()='OnLaunch']"
)
if (-not $rootNode -or -not $mainPackage -or -not $onLaunch) {
    throw "The staged $Channel App Installer is missing required elements."
}
if ($rootNode.NamespaceURI -ne "http://schemas.microsoft.com/appx/appinstaller/2021") {
    throw "The staged $Channel App Installer does not use the 2021 schema."
}
if (
    $rootNode.GetAttribute("Uri") -ne $artifacts.AppInstallerUri -or
    $mainPackage.GetAttribute("Uri") -ne $artifacts.PackageUri
) {
    throw "The staged $Channel App Installer URI is invalid."
}
if (
    $mainPackage.GetAttribute("Name") -ne $configuration.Raw.application.identityName -or
    $mainPackage.GetAttribute("Publisher") -ne $configuration.Raw.application.publisher -or
    $mainPackage.GetAttribute("Version") -ne $artifacts.PackageVersion -or
    $mainPackage.GetAttribute("ProcessorArchitecture") -ne $configuration.Raw.application.architecture
) {
    throw "The staged $Channel App Installer identity does not match release configuration."
}
if (
    $onLaunch.GetAttribute("HoursBetweenUpdateChecks") -ne "0" -or
    $onLaunch.GetAttribute("ShowPrompt") -ne "false" -or
    $onLaunch.GetAttribute("UpdateBlocksActivation") -ne "false"
) {
    throw "The staged $Channel launch update behavior is invalid."
}

$privateFiles = Get-ChildItem -LiteralPath $siteRoot -File -Recurse -Force |
    Where-Object { $_.Extension -in @(".pfx", ".p12", ".key") -or $_.Name -eq ".env" }
if ($privateFiles) {
    throw "Private material must not be staged for publication: $($privateFiles.FullName -join ', ')"
}

Write-Host "$Channel release verification passed: $siteRoot"
Write-Host "Package version: $($artifacts.PackageVersion)"
Write-Host "Signer thumbprint: $($signature.SignerCertificate.Thumbprint)"
Write-Host "MSIX SHA256: $((Get-FileHash -LiteralPath $artifacts.StagedPackagePath -Algorithm SHA256).Hash)"
