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
$siteDirectoryFullPath = [System.IO.Path]::GetFullPath($SiteDirectory)
if (-not $siteDirectoryFullPath.Equals($configuration.SiteDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to stage into a directory that differs from release configuration: $siteDirectoryFullPath"
}

foreach ($sourcePath in @(
    $configuration.SiteSourceDirectory,
    $artifacts.PackagePath,
    $artifacts.CertificatePath,
    $artifacts.AppInstallerPath
)) {
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        throw "Required release source was not found: $sourcePath"
    }
}

$identity = Get-MsixIdentity -PackagePath $artifacts.PackagePath
Assert-MsixIdentityMatchesConfiguration `
    -Identity $identity `
    -Configuration $configuration `
    -ExpectedVersion $artifacts.PackageVersion

$signature = Get-AuthenticodeSignature -LiteralPath $artifacts.PackagePath
if (-not $signature.SignerCertificate) {
    throw "The release MSIX package is not signed."
}
$publicCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
    $artifacts.CertificatePath
)
try {
    if ($signature.SignerCertificate.Thumbprint -ne $publicCertificate.Thumbprint) {
        throw "The release CER does not match the release MSIX signer."
    }
}
finally {
    $publicCertificate.Dispose()
}

[xml]$appInstaller = Get-Content -LiteralPath $artifacts.AppInstallerPath -Raw
$appInstallerRoot = $appInstaller.SelectSingleNode("/*[local-name()='AppInstaller']")
$mainPackage = $appInstaller.SelectSingleNode(
    "/*[local-name()='AppInstaller']/*[local-name()='MainPackage']"
)
if (-not $appInstallerRoot -or -not $mainPackage) {
    throw "The release App Installer is missing required elements."
}
if (
    $appInstallerRoot.GetAttribute("Uri") -ne $artifacts.AppInstallerUri -or
    $mainPackage.GetAttribute("Uri") -ne $artifacts.PackageUri -or
    $mainPackage.GetAttribute("Version") -ne $artifacts.PackageVersion
) {
    throw "The release App Installer does not match the $Channel channel artifacts."
}

New-Item -ItemType Directory -Path $siteDirectoryFullPath -Force | Out-Null
$siteSourceFiles = Get-ChildItem -LiteralPath $configuration.SiteSourceDirectory -File -Recurse -Force
foreach ($sourceFile in $siteSourceFiles) {
    $relativePath = [System.IO.Path]::GetRelativePath(
        $configuration.SiteSourceDirectory,
        $sourceFile.FullName
    )
    # 製品一覧はWebsite側の編集を正とし、製品リリースで全面置換しない。
    if ($relativePath -eq 'index.html') { continue }
    $destinationPath = [System.IO.Path]::GetFullPath((Join-Path $siteDirectoryFullPath $relativePath))
    if (-not $destinationPath.StartsWith($siteDirectoryFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to copy a site file outside the configured site directory: $destinationPath"
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
    Copy-Item -LiteralPath $sourceFile.FullName -Destination $destinationPath -Force
}

New-Item -ItemType Directory -Path $artifacts.Channel.SiteDirectory -Force | Out-Null
Copy-Item -LiteralPath $artifacts.PackagePath -Destination $artifacts.StagedPackagePath -Force
Copy-Item -LiteralPath $artifacts.CertificatePath -Destination $artifacts.StagedCertificatePath -Force
Copy-Item -LiteralPath $artifacts.AppInstallerPath -Destination $artifacts.StagedAppInstallerPath -Force

Write-Host "Staged $Channel release: $siteDirectoryFullPath"
Write-Host "Package version: $($artifacts.PackageVersion)"
Write-Host "Channel directory: $($artifacts.Channel.SiteDirectory)"
Get-ChildItem -LiteralPath $siteDirectoryFullPath -File -Recurse |
    Sort-Object FullName |
    Select-Object FullName, Length
