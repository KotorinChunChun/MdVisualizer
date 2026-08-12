[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [string]$PfxPath,
    [string]$PfxPassword,
    [string]$CertificateThumbprint,
    [string]$Publisher,
    [string]$PersistentCertificateFriendlyName,
    [int]$PersistentCertificateValidityYears = 5,
    [string]$TimestampUrl,
    [string]$ConfigPath,
    [switch]$SkipTauriBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$tauriRoot = Join-Path $projectRoot "src-tauri"
Import-Module (Join-Path $PSScriptRoot "ReleaseTools.psm1") -Force
$releaseConfiguration = Import-ReleaseConfiguration -Path $ConfigPath -ProjectRoot $projectRoot
$tauriConfigPath = $releaseConfiguration.TauriConfigPath
$manifestTemplatePath = Join-Path $projectRoot "packaging\msix\AppxManifest.xml.in"
$architecture = $releaseConfiguration.Raw.application.architecture
$identityName = $releaseConfiguration.Raw.application.identityName
$artifactBaseName = $releaseConfiguration.Raw.application.artifactBaseName
$publisherDisplayName = $releaseConfiguration.Raw.application.displayName
$stagingRoot = Join-Path $tauriRoot "target\msix\$architecture\layout"
$releaseExecutable = Join-Path $tauriRoot "target\release\markdown-viewer.exe"

if ([string]::IsNullOrWhiteSpace($Publisher)) {
    $Publisher = $releaseConfiguration.Raw.application.publisher
}
if ([string]::IsNullOrWhiteSpace($PersistentCertificateFriendlyName)) {
    $PersistentCertificateFriendlyName = $releaseConfiguration.Raw.application.certificateFriendlyName
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

function Test-CodeSigningCertificate {
    param(
        [Parameter(Mandatory)]
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate
    )

    if (-not $Certificate.HasPrivateKey) {
        return $false
    }
    if ($Certificate.NotBefore -gt (Get-Date) -or $Certificate.NotAfter -le (Get-Date)) {
        return $false
    }

    foreach ($extension in $Certificate.Extensions) {
        if ($extension -is [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]) {
            foreach ($usage in $extension.EnhancedKeyUsages) {
                if ($usage.Value -eq "1.3.6.1.5.5.7.3.3") {
                    return $true
                }
            }
        }
    }

    return $false
}

function Get-PersistentSigningCertificate {
    param(
        [Parameter(Mandatory)]
        [string]$Subject,
        [Parameter(Mandatory)]
        [string]$FriendlyName,
        [Parameter(Mandatory)]
        [int]$ValidityYears
    )

    if ($ValidityYears -lt 1 -or $ValidityYears -gt 20) {
        throw "PersistentCertificateValidityYears must be between 1 and 20."
    }

    $existingCertificate = Get-ChildItem -LiteralPath "Cert:\CurrentUser\My" |
        Where-Object {
            $_.Subject -eq $Subject -and
            $_.FriendlyName -eq $FriendlyName -and
            (Test-CodeSigningCertificate -Certificate $_)
        } |
        Sort-Object NotAfter -Descending |
        Select-Object -First 1

    if ($existingCertificate) {
        Write-Host "Reusing persistent signing certificate: $($existingCertificate.Thumbprint)"
        return $existingCertificate
    }

    $newCertificate = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $Subject `
        -FriendlyName $FriendlyName `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -KeyAlgorithm RSA `
        -KeyLength 3072 `
        -HashAlgorithm SHA256 `
        -KeyExportPolicy Exportable `
        -NotAfter (Get-Date).AddYears($ValidityYears)

    if (-not (Test-CodeSigningCertificate -Certificate $newCertificate)) {
        throw "The persistent code-signing certificate was created without a usable private key or Code Signing EKU."
    }

    Write-Host "Created persistent signing certificate: $($newCertificate.Thumbprint)"
    return $newCertificate
}

$tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$packageVersion = Convert-ToMsixVersion -Version $tauriConfig.version
$packageName = "${artifactBaseName}_${packageVersion}_${architecture}"
$outputDirectoryFullPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$msixPath = Join-Path $outputDirectoryFullPath "${packageName}.msix"
$certificatePath = Join-Path $outputDirectoryFullPath $releaseConfiguration.Raw.application.certificateFileName
$usingPfx = -not [string]::IsNullOrWhiteSpace($PfxPath)
$signingCertificate = $null
$signingPassword = $PfxPassword

New-Item -ItemType Directory -Path $outputDirectoryFullPath -Force | Out-Null

if ($usingPfx) {
    if (-not [string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
        throw "Specify either PfxPath or CertificateThumbprint, not both."
    }
    $PfxPath = [System.IO.Path]::GetFullPath($PfxPath)
    if (-not (Test-Path -LiteralPath $PfxPath)) {
        throw "Signing certificate was not found: $PfxPath"
    }
    $signingCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
        $PfxPath,
        $PfxPassword,
        [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
    )
    $Publisher = $signingCertificate.Subject
}
elseif (-not [string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
    $normalizedThumbprint = $CertificateThumbprint.Replace(" ", "").ToUpperInvariant()
    $signingCertificate = Get-ChildItem -LiteralPath "Cert:\CurrentUser\My\$normalizedThumbprint" -ErrorAction Stop
    if (-not (Test-CodeSigningCertificate -Certificate $signingCertificate)) {
        throw "The selected certificate does not have a usable private key and Code Signing EKU: $normalizedThumbprint"
    }
    $Publisher = $signingCertificate.Subject
}
else {
    $signingCertificate = Get-PersistentSigningCertificate `
        -Subject $Publisher `
        -FriendlyName $PersistentCertificateFriendlyName `
        -ValidityYears $PersistentCertificateValidityYears
}

$certificateBytes = $signingCertificate.Export(
    [System.Security.Cryptography.X509Certificates.X509ContentType]::Cert
)
if (Set-FileBytesIfChanged -Path $certificatePath -Bytes $certificateBytes) {
    Write-Host "Updated public certificate: $certificatePath"
}
else {
    Write-Host "Reusing unchanged public certificate file: $certificatePath"
}

try {
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
    Copy-Item -LiteralPath $releaseExecutable -Destination (Join-Path $safeStagingRoot "markdown-viewer.exe")
    foreach ($assetName in @("StoreLogo.png", "Square44x44Logo.png", "Square150x150Logo.png")) {
        Copy-Item `
            -LiteralPath (Join-Path $tauriRoot "icons\$assetName") `
            -Destination (Join-Path $assetsDirectory $assetName)
    }

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
    if ($usingPfx) {
        $signArguments += @("/f", $PfxPath)
        if (-not [string]::IsNullOrEmpty($signingPassword)) {
            $signArguments += @("/p", $signingPassword)
        }
    }
    else {
        $signArguments += @("/s", "My", "/sha1", $signingCertificate.Thumbprint)
    }
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
    if (-not $usingPfx) {
        Write-Warning "This package uses a self-signed certificate from Cert:\CurrentUser\My. Keep its private key for future updates and trust the .cer file on client devices."
    }
}
finally {
    if ($signingCertificate) {
        $signingCertificate.Dispose()
    }
}
