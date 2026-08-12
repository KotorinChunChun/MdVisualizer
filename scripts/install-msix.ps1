[CmdletBinding()]
param(
    [string]$MsixPath,
    [string]$CertificatePath,
    [string]$ConfigPath,
    [switch]$TrustDevelopmentCertificate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$defaultOutputDirectory = Join-Path $projectRoot "release\msix"
Import-Module (Join-Path $PSScriptRoot "ReleaseTools.psm1") -Force
$releaseConfiguration = Import-ReleaseConfiguration -Path $ConfigPath -ProjectRoot $projectRoot

if ([string]::IsNullOrWhiteSpace($MsixPath)) {
    $latestPackage = Get-ChildItem -LiteralPath $defaultOutputDirectory -Filter "*.msix" -File |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if (-not $latestPackage) {
        throw "No MSIX package was found in $defaultOutputDirectory"
    }
    $MsixPath = $latestPackage.FullName
}
else {
    $MsixPath = [System.IO.Path]::GetFullPath($MsixPath)
}

if (-not (Test-Path -LiteralPath $MsixPath)) {
    throw "MSIX package was not found: $MsixPath"
}

if ([string]::IsNullOrWhiteSpace($CertificatePath)) {
    $CertificatePath = Join-Path `
        (Split-Path -Parent $MsixPath) `
        $releaseConfiguration.Raw.application.certificateFileName
}
else {
    $CertificatePath = [System.IO.Path]::GetFullPath($CertificatePath)
}

$signature = Get-AuthenticodeSignature -LiteralPath $MsixPath
if (-not $signature.SignerCertificate) {
    throw "The MSIX package is not signed."
}
if ($signature.Status -in @("HashMismatch", "NotSigned")) {
    throw "MSIX signature validation failed: $($signature.StatusMessage)"
}

$trustedCertificate = Get-ChildItem -LiteralPath "Cert:\CurrentUser\TrustedPeople" |
    Where-Object Thumbprint -EQ $signature.SignerCertificate.Thumbprint |
    Select-Object -First 1

if (-not $trustedCertificate) {
    if (-not $TrustDevelopmentCertificate) {
        throw "The signing certificate is not trusted. Review the .cer file, then rerun with -TrustDevelopmentCertificate."
    }
    if (-not (Test-Path -LiteralPath $CertificatePath)) {
        throw "Public certificate was not found: $CertificatePath"
    }

    $certificateToTrust = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($CertificatePath)
    try {
        if ($certificateToTrust.Thumbprint -ne $signature.SignerCertificate.Thumbprint) {
            throw "The public certificate does not match the MSIX signer."
        }
    }
    finally {
        $certificateToTrust.Dispose()
    }

    Import-Certificate `
        -FilePath $CertificatePath `
        -CertStoreLocation "Cert:\CurrentUser\TrustedPeople" | Out-Null
}

Add-AppxPackage -Path $MsixPath
Write-Host "Installed: $MsixPath"
