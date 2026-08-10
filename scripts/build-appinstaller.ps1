[CmdletBinding()]
param(
    [string]$MsixPath,
    [string]$OutputPath,
    [string]$ChannelBaseUri = "https://excel-chunchun.sakura.ne.jp/download/beta/"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$defaultOutputDirectory = Join-Path $projectRoot "release\msix"
$templatePath = Join-Path $projectRoot "packaging\msix\AppInstaller.xml.in"

function Get-XmlEscapedValue {
    param(
        [Parameter(Mandatory)]
        [string]$Value
    )

    return [System.Security.SecurityElement]::Escape($Value)
}

function Get-MsixIdentity {
    param(
        [Parameter(Mandatory)]
        [string]$PackagePath
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($PackagePath)
    try {
        $manifestEntry = $archive.Entries |
            Where-Object FullName -EQ "AppxManifest.xml" |
            Select-Object -First 1
        if (-not $manifestEntry) {
            throw "AppxManifest.xml was not found in the MSIX package: $PackagePath"
        }

        $stream = $manifestEntry.Open()
        try {
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true)
            try {
                [xml]$manifest = $reader.ReadToEnd()
            }
            finally {
                $reader.Dispose()
            }
        }
        finally {
            $stream.Dispose()
        }

        $identity = $manifest.SelectSingleNode(
            "/*[local-name()='Package']/*[local-name()='Identity']"
        )
        if (-not $identity) {
            throw "Package Identity was not found in AppxManifest.xml."
        }

        return @{
            Name = $identity.GetAttribute("Name")
            Publisher = $identity.GetAttribute("Publisher")
            Version = $identity.GetAttribute("Version")
            Architecture = $identity.GetAttribute("ProcessorArchitecture")
        }
    }
    finally {
        $archive.Dispose()
    }
}

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

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path (Split-Path -Parent $MsixPath) "MarkdownViewer.appinstaller"
}
else {
    $OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
}

$baseUri = $null
if (-not [System.Uri]::TryCreate($ChannelBaseUri, [System.UriKind]::Absolute, [ref]$baseUri)) {
    throw "ChannelBaseUri must be an absolute URI: $ChannelBaseUri"
}
if ($baseUri.Scheme -ne "https") {
    throw "ChannelBaseUri must use HTTPS: $ChannelBaseUri"
}

$normalizedBaseUri = $baseUri.AbsoluteUri.TrimEnd("/") + "/"
$appInstallerFileName = [System.IO.Path]::GetFileName($OutputPath)
$msixFileName = [System.IO.Path]::GetFileName($MsixPath)
$appInstallerUri = [System.Uri]::new($normalizedBaseUri + $appInstallerFileName).AbsoluteUri
$packageUri = [System.Uri]::new($normalizedBaseUri + $msixFileName).AbsoluteUri
$identity = Get-MsixIdentity -PackagePath $MsixPath

foreach ($key in @("Name", "Publisher", "Version", "Architecture")) {
    if ([string]::IsNullOrWhiteSpace($identity[$key])) {
        throw "The MSIX Identity $key is empty."
    }
}

$template = Get-Content -LiteralPath $templatePath -Raw
$appInstaller = $template
$appInstaller = $appInstaller.Replace("@@IDENTITY_NAME@@", (Get-XmlEscapedValue $identity.Name))
$appInstaller = $appInstaller.Replace("@@PUBLISHER@@", (Get-XmlEscapedValue $identity.Publisher))
$appInstaller = $appInstaller.Replace("@@PACKAGE_VERSION@@", (Get-XmlEscapedValue $identity.Version))
$appInstaller = $appInstaller.Replace("@@ARCHITECTURE@@", (Get-XmlEscapedValue $identity.Architecture))
$appInstaller = $appInstaller.Replace("@@APPINSTALLER_URI@@", (Get-XmlEscapedValue $appInstallerUri))
$appInstaller = $appInstaller.Replace("@@PACKAGE_URI@@", (Get-XmlEscapedValue $packageUri))

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
[System.IO.File]::WriteAllText(
    $OutputPath,
    $appInstaller,
    [System.Text.UTF8Encoding]::new($false)
)

[xml]$generatedDocument = Get-Content -LiteralPath $OutputPath -Raw
$appInstallerNode = $generatedDocument.SelectSingleNode("/*[local-name()='AppInstaller']")
$mainPackageNode = $generatedDocument.SelectSingleNode(
    "/*[local-name()='AppInstaller']/*[local-name()='MainPackage']"
)
$onLaunchNode = $generatedDocument.SelectSingleNode(
    "/*[local-name()='AppInstaller']/*[local-name()='UpdateSettings']/*[local-name()='OnLaunch']"
)

if (-not $appInstallerNode -or -not $mainPackageNode -or -not $onLaunchNode) {
    throw "The generated App Installer file is missing required elements."
}
if ($appInstallerNode.GetAttribute("Uri") -ne $appInstallerUri) {
    throw "The generated App Installer URI does not match the beta channel URI."
}
foreach ($mapping in @{
    Name = $identity.Name
    Publisher = $identity.Publisher
    Version = $identity.Version
    ProcessorArchitecture = $identity.Architecture
    Uri = $packageUri
}.GetEnumerator()) {
    if ($mainPackageNode.GetAttribute($mapping.Key) -ne $mapping.Value) {
        throw "The generated MainPackage $($mapping.Key) does not match the MSIX Identity."
    }
}
if (
    $onLaunchNode.GetAttribute("HoursBetweenUpdateChecks") -ne "0" -or
    $onLaunchNode.GetAttribute("ShowPrompt") -ne "false" -or
    $onLaunchNode.GetAttribute("UpdateBlocksActivation") -ne "false"
) {
    throw "The generated App Installer launch update settings are invalid."
}

Write-Host "App Installer: $OutputPath"
Write-Host "App Installer URI: $appInstallerUri"
Write-Host "MSIX URI: $packageUri"
