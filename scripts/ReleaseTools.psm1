Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ConvertTo-MsixVersion {
    [CmdletBinding()]
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

function Assert-AbsoluteHttpsUri {
    param(
        [Parameter(Mandatory)]
        [string]$Name,
        [Parameter(Mandatory)]
        [string]$Value
    )

    $parsedUri = $null
    if (-not [System.Uri]::TryCreate($Value, [System.UriKind]::Absolute, [ref]$parsedUri)) {
        throw "$Name must be an absolute URI: $Value"
    }
    if ($parsedUri.Scheme -ne "https") {
        throw "$Name must use HTTPS: $Value"
    }

    return $parsedUri.AbsoluteUri
}

function Import-ReleaseConfiguration {
    [CmdletBinding()]
    param(
        [string]$Path,
        [string]$ProjectRoot
    )

    if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
        $ProjectRoot = Split-Path -Parent $PSScriptRoot
    }
    $projectRootFullPath = [System.IO.Path]::GetFullPath($ProjectRoot)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        $Path = Join-Path $projectRootFullPath "packaging\release-config.json"
    }
    else {
        $Path = [System.IO.Path]::GetFullPath($Path)
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Release configuration was not found: $Path"
    }

    $configuration = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if ($configuration.schemaVersion -ne 1) {
        throw "Unsupported release configuration schemaVersion: $($configuration.schemaVersion)"
    }

    $requiredValues = [ordered]@{
        "application.displayName" = $configuration.application.displayName
        "application.artifactBaseName" = $configuration.application.artifactBaseName
        "application.identityName" = $configuration.application.identityName
        "application.publisher" = $configuration.application.publisher
        "application.architecture" = $configuration.application.architecture
        "application.certificateFriendlyName" = $configuration.application.certificateFriendlyName
        "build.tauriConfig" = $configuration.build.tauriConfig
        "build.releaseDirectory" = $configuration.build.releaseDirectory
        "build.siteSourceDirectory" = $configuration.build.siteSourceDirectory
        "distribution.websiteProjectDirectory" = $configuration.distribution.websiteProjectDirectory
        "distribution.siteRelativeDirectory" = $configuration.distribution.siteRelativeDirectory
        "distribution.ftpUploadScript" = $configuration.distribution.ftpUploadScript
        "distribution.publicDownloadPage" = $configuration.distribution.publicDownloadPage
    }
    foreach ($entry in $requiredValues.GetEnumerator()) {
        if ([string]::IsNullOrWhiteSpace([string]$entry.Value)) {
            throw "Required release configuration value is empty: $($entry.Key)"
        }
    }

    if ($configuration.application.architecture -notin @("x64", "x86", "arm64")) {
        throw "Unsupported release architecture: $($configuration.application.architecture)"
    }

    [void](Assert-AbsoluteHttpsUri -Name "distribution.publicDownloadPage" -Value $configuration.distribution.publicDownloadPage)
    foreach ($channelName in @("beta", "stable")) {
        $channel = $configuration.channels.$channelName
        if (-not $channel) {
            throw "Required release channel is missing: $channelName"
        }
        foreach ($propertyName in @("relativeDirectory", "baseUri", "appInstallerFileName")) {
            if ([string]::IsNullOrWhiteSpace([string]$channel.$propertyName)) {
                throw "Required release channel value is empty: channels.$channelName.$propertyName"
            }
        }
        [void](Assert-AbsoluteHttpsUri -Name "channels.$channelName.baseUri" -Value $channel.baseUri)
        if ([System.IO.Path]::GetFileName($channel.appInstallerFileName) -ne $channel.appInstallerFileName) {
            throw "App Installer file name must not contain a directory: $($channel.appInstallerFileName)"
        }
    }

    $websiteProjectDirectory = [System.IO.Path]::GetFullPath(
        $configuration.distribution.websiteProjectDirectory
    )
    $siteDirectory = [System.IO.Path]::GetFullPath(
        (Join-Path $websiteProjectDirectory $configuration.distribution.siteRelativeDirectory)
    )
    if (-not $siteDirectory.StartsWith($websiteProjectDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Configured site directory escapes the website project: $siteDirectory"
    }

    return [pscustomobject]@{
        Raw = $configuration
        ConfigPath = $Path
        ProjectRoot = $projectRootFullPath
        TauriConfigPath = [System.IO.Path]::GetFullPath((Join-Path $projectRootFullPath $configuration.build.tauriConfig))
        ReleaseDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectRootFullPath $configuration.build.releaseDirectory))
        SiteSourceDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectRootFullPath $configuration.build.siteSourceDirectory))
        WebsiteProjectDirectory = $websiteProjectDirectory
        SiteDirectory = $siteDirectory
        FtpUploadScriptPath = [System.IO.Path]::GetFullPath((Join-Path $websiteProjectDirectory $configuration.distribution.ftpUploadScript))
    }
}

function Get-ReleaseChannel {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [pscustomobject]$Configuration,
        [Parameter(Mandatory)]
        [ValidateSet("beta", "stable")]
        [string]$Channel
    )

    $channelConfiguration = $Configuration.Raw.channels.$Channel
    $baseUri = (Assert-AbsoluteHttpsUri -Name "channels.$Channel.baseUri" -Value $channelConfiguration.baseUri).TrimEnd("/") + "/"
    return [pscustomobject]@{
        Name = $Channel
        RelativeDirectory = $channelConfiguration.relativeDirectory
        BaseUri = $baseUri
        AppInstallerFileName = $channelConfiguration.appInstallerFileName
        SiteDirectory = [System.IO.Path]::GetFullPath((Join-Path $Configuration.SiteDirectory $channelConfiguration.relativeDirectory))
    }
}

function Get-ConfiguredApplicationVersion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [pscustomobject]$Configuration
    )

    if (-not (Test-Path -LiteralPath $Configuration.TauriConfigPath -PathType Leaf)) {
        throw "Tauri configuration was not found: $($Configuration.TauriConfigPath)"
    }
    $tauriConfiguration = Get-Content -LiteralPath $Configuration.TauriConfigPath -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace([string]$tauriConfiguration.version)) {
        throw "Tauri application version is empty: $($Configuration.TauriConfigPath)"
    }
    return [string]$tauriConfiguration.version
}

function Get-ReleaseArtifacts {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [pscustomobject]$Configuration,
        [Parameter(Mandatory)]
        [ValidateSet("beta", "stable")]
        [string]$Channel,
        [string]$ApplicationVersion
    )

    if ([string]::IsNullOrWhiteSpace($ApplicationVersion)) {
        $ApplicationVersion = Get-ConfiguredApplicationVersion -Configuration $Configuration
    }
    $packageVersion = ConvertTo-MsixVersion -Version $ApplicationVersion
    $channelConfiguration = Get-ReleaseChannel -Configuration $Configuration -Channel $Channel
    $artifactBaseName = $Configuration.Raw.application.artifactBaseName
    $architecture = $Configuration.Raw.application.architecture
    $packageFileName = "${artifactBaseName}_${packageVersion}_${architecture}.msix"
    $certificateFileName = "${artifactBaseName}_${packageVersion}_${architecture}.cer"
    $appInstallerFileName = $channelConfiguration.AppInstallerFileName

    return [pscustomobject]@{
        ApplicationVersion = $ApplicationVersion
        PackageVersion = $packageVersion
        Channel = $channelConfiguration
        PackageFileName = $packageFileName
        CertificateFileName = $certificateFileName
        AppInstallerFileName = $appInstallerFileName
        PackagePath = Join-Path $Configuration.ReleaseDirectory $packageFileName
        CertificatePath = Join-Path $Configuration.ReleaseDirectory $certificateFileName
        AppInstallerPath = Join-Path $Configuration.ReleaseDirectory $appInstallerFileName
        StagedPackagePath = Join-Path $channelConfiguration.SiteDirectory $packageFileName
        StagedCertificatePath = Join-Path $channelConfiguration.SiteDirectory $certificateFileName
        StagedAppInstallerPath = Join-Path $channelConfiguration.SiteDirectory $appInstallerFileName
        PackageUri = $channelConfiguration.BaseUri + $packageFileName
        AppInstallerUri = $channelConfiguration.BaseUri + $appInstallerFileName
    }
}

function Get-MsixIdentity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$PackagePath
    )

    $packagePathFullPath = [System.IO.Path]::GetFullPath($PackagePath)
    if (-not (Test-Path -LiteralPath $packagePathFullPath -PathType Leaf)) {
        throw "MSIX package was not found: $packagePathFullPath"
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($packagePathFullPath)
    try {
        $manifestEntry = $archive.Entries |
            Where-Object FullName -EQ "AppxManifest.xml" |
            Select-Object -First 1
        if (-not $manifestEntry) {
            throw "AppxManifest.xml was not found in the MSIX package: $packagePathFullPath"
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

        $identity = $manifest.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Identity']")
        if (-not $identity) {
            throw "Package Identity was not found in AppxManifest.xml."
        }

        return [pscustomobject]@{
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

function Assert-MsixIdentityMatchesConfiguration {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [pscustomobject]$Identity,
        [Parameter(Mandatory)]
        [pscustomobject]$Configuration,
        [string]$ExpectedVersion
    )

    $expected = [ordered]@{
        Name = $Configuration.Raw.application.identityName
        Publisher = $Configuration.Raw.application.publisher
        Architecture = $Configuration.Raw.application.architecture
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedVersion)) {
        $expected.Version = $ExpectedVersion
    }

    foreach ($entry in $expected.GetEnumerator()) {
        if ([string]$Identity.($entry.Key) -ne [string]$entry.Value) {
            throw "MSIX Identity $($entry.Key) does not match release configuration. Expected '$($entry.Value)', actual '$($Identity.($entry.Key))'."
        }
    }
}

Export-ModuleMember -Function @(
    "ConvertTo-MsixVersion",
    "Import-ReleaseConfiguration",
    "Get-ReleaseChannel",
    "Get-ConfiguredApplicationVersion",
    "Get-ReleaseArtifacts",
    "Get-MsixIdentity",
    "Assert-MsixIdentityMatchesConfiguration"
)
