[CmdletBinding()]
param(
    [string]$SiteDirectory = "C:\develop\excel-chunchun\www\download"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$siteSourceDirectory = Join-Path $projectRoot "packaging\site"
$releaseDirectory = Join-Path $projectRoot "release\msix"
$msixFileName = "MarkdownViewer_0.0.7.0_x64.msix"
$certificateFileName = "MarkdownViewer_0.0.7.0_x64.cer"
$appInstallerFileName = "MarkdownViewer.appinstaller"

$siteDirectoryFullPath = [System.IO.Path]::GetFullPath($SiteDirectory)
$expectedSiteDirectory = [System.IO.Path]::GetFullPath(
    "C:\develop\excel-chunchun\www\download"
)
if (-not $siteDirectoryFullPath.Equals($expectedSiteDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to stage into an unexpected directory: $siteDirectoryFullPath"
}

$requiredSourceFiles = @(
    (Join-Path $siteSourceDirectory ".htaccess"),
    (Join-Path $siteSourceDirectory "index.html"),
    (Join-Path $siteSourceDirectory "certificate\index.html"),
    (Join-Path $siteSourceDirectory "assets\styles.css"),
    (Join-Path $siteSourceDirectory "assets\markdownviewer-icon.png"),
    (Join-Path $releaseDirectory $msixFileName),
    (Join-Path $releaseDirectory $certificateFileName),
    (Join-Path $releaseDirectory $appInstallerFileName)
)
foreach ($sourceFile in $requiredSourceFiles) {
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
        throw "Required release file was not found: $sourceFile"
    }
}

$assetsDirectory = Join-Path $siteDirectoryFullPath "assets"
$certificateDirectory = Join-Path $siteDirectoryFullPath "certificate"
$betaDirectory = Join-Path $siteDirectoryFullPath "beta"
foreach ($directory in @($siteDirectoryFullPath, $assetsDirectory, $certificateDirectory, $betaDirectory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

Copy-Item -LiteralPath (Join-Path $siteSourceDirectory ".htaccess") -Destination (Join-Path $siteDirectoryFullPath ".htaccess") -Force
Copy-Item -LiteralPath (Join-Path $siteSourceDirectory "index.html") -Destination (Join-Path $siteDirectoryFullPath "index.html") -Force
Copy-Item -LiteralPath (Join-Path $siteSourceDirectory "certificate\index.html") -Destination (Join-Path $certificateDirectory "index.html") -Force
Copy-Item -LiteralPath (Join-Path $siteSourceDirectory "assets\styles.css") -Destination (Join-Path $assetsDirectory "styles.css") -Force
Copy-Item -LiteralPath (Join-Path $siteSourceDirectory "assets\markdownviewer-icon.png") -Destination (Join-Path $assetsDirectory "markdownviewer-icon.png") -Force
Copy-Item -LiteralPath (Join-Path $releaseDirectory $msixFileName) -Destination (Join-Path $betaDirectory $msixFileName) -Force
Copy-Item -LiteralPath (Join-Path $releaseDirectory $certificateFileName) -Destination (Join-Path $betaDirectory $certificateFileName) -Force
Copy-Item -LiteralPath (Join-Path $releaseDirectory $appInstallerFileName) -Destination (Join-Path $betaDirectory $appInstallerFileName) -Force

$signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $betaDirectory $msixFileName)
if (-not $signature.SignerCertificate) {
    throw "The staged MSIX package is not signed."
}

$publicCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
    (Join-Path $betaDirectory $certificateFileName)
)
try {
    if ($signature.SignerCertificate.Thumbprint -ne $publicCertificate.Thumbprint) {
        throw "The staged CER does not match the staged MSIX signer."
    }
}
finally {
    $publicCertificate.Dispose()
}

[xml]$appInstaller = Get-Content -LiteralPath (Join-Path $betaDirectory $appInstallerFileName) -Raw
$mainPackage = $appInstaller.SelectSingleNode(
    "/*[local-name()='AppInstaller']/*[local-name()='MainPackage']"
)
if (-not $mainPackage -or $mainPackage.GetAttribute("Version") -ne "0.0.7.0") {
    throw "The staged App Installer does not target package version 0.0.7.0."
}

Write-Host "Staged beta release: $siteDirectoryFullPath"
Get-ChildItem -LiteralPath $siteDirectoryFullPath -File -Recurse |
    Sort-Object FullName |
    Select-Object FullName, Length
