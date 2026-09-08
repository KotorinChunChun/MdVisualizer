[CmdletBinding()]
param(
    [string]$MsixPath,
    [string]$OutputPath,
    [ValidateSet("beta", "stable")]
    [string]$Channel = "beta",
    [string]$ConfigPath,
    [string]$ChannelBaseUri
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$templatePath = Join-Path $projectRoot "packaging\msix\AppInstaller.xml.in"
Import-Module (Join-Path $PSScriptRoot "ReleaseTools.psm1") -Force
$releaseConfiguration = Import-ReleaseConfiguration -Path $ConfigPath -ProjectRoot $projectRoot
$artifacts = Get-ReleaseArtifacts -Configuration $releaseConfiguration -Channel $Channel

function Get-XmlEscapedValue {
    param(
        [Parameter(Mandatory)]
        [string]$Value
    )

    return [System.Security.SecurityElement]::Escape($Value)
}

if ([string]::IsNullOrWhiteSpace($MsixPath)) {
    $MsixPath = $artifacts.PackagePath
}
else {
    $MsixPath = [System.IO.Path]::GetFullPath($MsixPath)
}

if (-not (Test-Path -LiteralPath $MsixPath)) {
    throw "MSIX package was not found: $MsixPath"
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = $artifacts.AppInstallerPath
}
else {
    $OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
}

if ([string]::IsNullOrWhiteSpace($ChannelBaseUri)) {
    $ChannelBaseUri = $artifacts.Channel.BaseUri
}

$baseUri = $null
if (
    -not [System.Uri]::TryCreate($ChannelBaseUri, [System.UriKind]::Absolute, [ref]$baseUri) -or
    $baseUri.Scheme -ne "https"
) {
    throw "ChannelBaseUri must be an absolute HTTPS URI: $ChannelBaseUri"
}
$normalizedBaseUri = $baseUri.AbsoluteUri.TrimEnd("/") + "/"
$appInstallerFileName = [System.IO.Path]::GetFileName($OutputPath)
$msixFileName = [System.IO.Path]::GetFileName($MsixPath)
$appInstallerUri = [System.Uri]::new($normalizedBaseUri + $appInstallerFileName).AbsoluteUri
$packageUri = [System.Uri]::new($normalizedBaseUri + $msixFileName).AbsoluteUri
$identity = Get-MsixIdentity -PackagePath $MsixPath
Assert-MsixIdentityMatchesConfiguration `
    -Identity $identity `
    -Configuration $releaseConfiguration `
    -ExpectedVersion $artifacts.PackageVersion

foreach ($key in @("Name", "Publisher", "Version", "Architecture")) {
    $identityProperty = $identity.PSObject.Properties[$key]
    if (-not $identityProperty -or [string]::IsNullOrWhiteSpace([string]$identityProperty.Value)) {
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
    throw "The generated App Installer URI does not match the $Channel channel URI."
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
Write-Host "Channel: $Channel"
Write-Host "App Installer URI: $appInstallerUri"
Write-Host "MSIX URI: $packageUri"
