[CmdletBinding()]
param(
    [string]$SiteDirectory = "C:\develop\excel-chunchun\www\download"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$siteRoot = [System.IO.Path]::GetFullPath($SiteDirectory)
$expectedSiteRoot = [System.IO.Path]::GetFullPath("C:\develop\excel-chunchun\www\download")
if (-not $siteRoot.Equals($expectedSiteRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to verify an unexpected directory: $siteRoot"
}

$requiredFiles = @(
    ".htaccess",
    "index.html",
    "certificate\index.html",
    "assets\styles.css",
    "assets\markdownviewer-icon.png",
    "beta\MarkdownViewer_0.0.7.0_x64.msix",
    "beta\MarkdownViewer_0.0.7.0_x64.cer",
    "beta\MarkdownViewer.appinstaller"
)
foreach ($relativePath in $requiredFiles) {
    $fullPath = Join-Path $siteRoot $relativePath
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        throw "Required beta release file is missing: $fullPath"
    }
    if ((Get-Item -LiteralPath $fullPath).Length -eq 0) {
        throw "Required beta release file is empty: $fullPath"
    }
}

$htmlFiles = @(
    (Join-Path $siteRoot "index.html"),
    (Join-Path $siteRoot "certificate\index.html")
)
foreach ($htmlPath in $htmlFiles) {
    $html = Get-Content -LiteralPath $htmlPath -Raw
    if ($html -notmatch '<html\s+lang="ja"' -or $html -notmatch '<meta\s+name="viewport"') {
        throw "Required language or viewport metadata is missing: $htmlPath"
    }
    if ([regex]::Matches($html, '<h1(?:\s[^>]*)?>').Count -ne 1) {
        throw "Each page must contain exactly one h1: $htmlPath"
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
            (Join-Path (Split-Path -Parent $htmlPath) $referenceWithoutFragment)
        )
        if (-not $resolvedReference.StartsWith($siteRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Local reference escapes the site root: $htmlPath -> $reference"
        }
        if (Test-Path -LiteralPath $resolvedReference -PathType Container) {
            $resolvedReference = Join-Path $resolvedReference "index.html"
        }
        if (-not (Test-Path -LiteralPath $resolvedReference -PathType Leaf)) {
            throw "Broken local reference: $htmlPath -> $reference"
        }
    }
}

$htaccess = Get-Content -LiteralPath (Join-Path $siteRoot ".htaccess") -Raw
foreach ($mimeMapping in @("application/msix .msix", "application/appinstaller .appinstaller")) {
    if (-not $htaccess.Contains($mimeMapping)) {
        throw "Required MIME mapping is missing from .htaccess: $mimeMapping"
    }
}

$msixPath = Join-Path $siteRoot "beta\MarkdownViewer_0.0.7.0_x64.msix"
$certificatePath = Join-Path $siteRoot "beta\MarkdownViewer_0.0.7.0_x64.cer"
$appInstallerPath = Join-Path $siteRoot "beta\MarkdownViewer.appinstaller"
$signature = Get-AuthenticodeSignature -LiteralPath $msixPath
if (-not $signature.SignerCertificate) {
    throw "The beta MSIX does not contain a signer certificate."
}

$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificatePath)
try {
    if ($certificate.Thumbprint -ne $signature.SignerCertificate.Thumbprint) {
        throw "The beta CER does not match the beta MSIX signer."
    }
}
finally {
    $certificate.Dispose()
}

[xml]$appInstaller = Get-Content -LiteralPath $appInstallerPath -Raw
$rootNode = $appInstaller.SelectSingleNode("/*[local-name()='AppInstaller']")
$mainPackage = $appInstaller.SelectSingleNode(
    "/*[local-name()='AppInstaller']/*[local-name()='MainPackage']"
)
$onLaunch = $appInstaller.SelectSingleNode(
    "/*[local-name()='AppInstaller']/*[local-name()='UpdateSettings']/*[local-name()='OnLaunch']"
)
if (-not $rootNode -or -not $mainPackage -or -not $onLaunch) {
    throw "The beta App Installer file is missing required elements."
}
if ($rootNode.NamespaceURI -ne "http://schemas.microsoft.com/appx/appinstaller/2021") {
    throw "The beta App Installer file does not use the 2021 schema."
}
if ($rootNode.GetAttribute("Uri") -ne "https://excel-chunchun.sakura.ne.jp/download/beta/MarkdownViewer.appinstaller") {
    throw "The beta App Installer URI is invalid."
}
if ($mainPackage.GetAttribute("Uri") -ne "https://excel-chunchun.sakura.ne.jp/download/beta/MarkdownViewer_0.0.7.0_x64.msix") {
    throw "The beta MSIX URI is invalid."
}
if (
    $mainPackage.GetAttribute("Name") -ne "com.markdownviewer.viewer" -or
    $mainPackage.GetAttribute("Publisher") -ne "CN=KotorinChunChun" -or
    $mainPackage.GetAttribute("Version") -ne "0.0.7.0" -or
    $mainPackage.GetAttribute("ProcessorArchitecture") -ne "x64"
) {
    throw "The beta App Installer identity does not match the release package."
}
if (
    $onLaunch.GetAttribute("HoursBetweenUpdateChecks") -ne "0" -or
    $onLaunch.GetAttribute("ShowPrompt") -ne "false" -or
    $onLaunch.GetAttribute("UpdateBlocksActivation") -ne "false"
) {
    throw "The beta launch update behavior is invalid."
}

$privateFiles = Get-ChildItem -LiteralPath $siteRoot -File -Recurse |
    Where-Object { $_.Extension -in @(".pfx", ".p12", ".key") -or $_.Name -eq ".env" }
if ($privateFiles) {
    throw "Private material must not be staged for publication: $($privateFiles.FullName -join ', ')"
}

Write-Host "Beta release verification passed: $siteRoot"
Write-Host "Signer thumbprint: $($signature.SignerCertificate.Thumbprint)"
Write-Host "MSIX SHA256: $((Get-FileHash -LiteralPath $msixPath -Algorithm SHA256).Hash)"
