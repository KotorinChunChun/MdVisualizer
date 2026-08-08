[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [string]$PfxPath,
    [string]$PfxPassword,
    [string]$Publisher = "CN=KotorinChunChun",
    [string]$TimestampUrl,
    [switch]$SkipTauriBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$tauriRoot = Join-Path $projectRoot "src-tauri"
$tauriConfigPath = Join-Path $tauriRoot "tauri.conf.json"
$manifestTemplatePath = Join-Path $projectRoot "packaging\msix\AppxManifest.xml.in"
$stagingRoot = Join-Path $tauriRoot "target\msix\x64\layout"
$releaseExecutable = Join-Path $tauriRoot "target\release\markdown-viewer.exe"

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $projectRoot "release\msix"
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

    $parts = $Version.Split(".")
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

function New-DevelopmentSigningCertificate {
    param(
        [Parameter(Mandatory)]
        [string]$Subject,
        [Parameter(Mandatory)]
        [string]$TemporaryPfxPath,
        [Parameter(Mandatory)]
        [string]$PublicCertificatePath
    )

    $rsa = [System.Security.Cryptography.RSA]::Create(3072)
    try {
        $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
            $Subject,
            $rsa,
            [System.Security.Cryptography.HashAlgorithmName]::SHA256,
            [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
        )
        $request.CertificateExtensions.Add(
            [System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
                [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature,
                $true
            )
        )
        $enhancedKeyUsages = [System.Security.Cryptography.OidCollection]::new()
        [void]$enhancedKeyUsages.Add(
            [System.Security.Cryptography.Oid]::new("1.3.6.1.5.5.7.3.3", "Code Signing")
        )
        $request.CertificateExtensions.Add(
            [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new(
                $enhancedKeyUsages,
                $false
            )
        )
        $request.CertificateExtensions.Add(
            [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new(
                $false,
                $false,
                0,
                $true
            )
        )

        $certificate = $request.CreateSelfSigned(
            [DateTimeOffset]::UtcNow.AddMinutes(-5),
            [DateTimeOffset]::UtcNow.AddYears(2)
        )
        try {
            $passwordBytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
            $password = [Convert]::ToBase64String($passwordBytes)
            [System.IO.File]::WriteAllBytes(
                $TemporaryPfxPath,
                $certificate.Export(
                    [System.Security.Cryptography.X509Certificates.X509ContentType]::Pkcs12,
                    $password
                )
            )
            [System.IO.File]::WriteAllBytes(
                $PublicCertificatePath,
                $certificate.Export(
                    [System.Security.Cryptography.X509Certificates.X509ContentType]::Cert
                )
            )

            return @{
                Certificate = $certificate
                Password = $password
            }
        }
        catch {
            $certificate.Dispose()
            throw
        }
    }
    finally {
        $rsa.Dispose()
    }
}

$tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$packageVersion = Convert-ToMsixVersion -Version $tauriConfig.version
$packageName = "MarkdownViewer_${packageVersion}_x64"
$outputDirectoryFullPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$msixPath = Join-Path $outputDirectoryFullPath "${packageName}.msix"
$certificatePath = Join-Path $outputDirectoryFullPath "${packageName}.cer"
$temporaryPfxPath = Join-Path $tauriRoot "target\msix\development-signing.pfx"
$usingDevelopmentCertificate = [string]::IsNullOrWhiteSpace($PfxPath)
$signingCertificate = $null
$signingPassword = $PfxPassword

New-Item -ItemType Directory -Path $outputDirectoryFullPath -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $temporaryPfxPath) -Force | Out-Null

if ($usingDevelopmentCertificate) {
    $developmentCertificate = New-DevelopmentSigningCertificate `
        -Subject $Publisher `
        -TemporaryPfxPath $temporaryPfxPath `
        -PublicCertificatePath $certificatePath
    $signingCertificate = $developmentCertificate.Certificate
    $signingPassword = $developmentCertificate.Password
    $PfxPath = $temporaryPfxPath
}
else {
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
    [System.IO.File]::WriteAllBytes(
        $certificatePath,
        $signingCertificate.Export(
            [System.Security.Cryptography.X509Certificates.X509ContentType]::Cert
        )
    )
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
    $manifest = $manifest.Replace("@@IDENTITY_NAME@@", "com.markdownviewer.viewer")
    $manifest = $manifest.Replace(
        "@@PUBLISHER@@",
        [System.Security.SecurityElement]::Escape($Publisher)
    )
    $manifest = $manifest.Replace("@@PACKAGE_VERSION@@", $packageVersion)
    $manifest = $manifest.Replace("@@ARCHITECTURE@@", "x64")
    $manifest = $manifest.Replace("@@PUBLISHER_DISPLAY_NAME@@", "KotorinChunChun")
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
        "SHA256",
        "/f",
        $PfxPath
    )
    if (-not [string]::IsNullOrEmpty($signingPassword)) {
        $signArguments += @("/p", $signingPassword)
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
    if ($usingDevelopmentCertificate) {
        Write-Warning "This package uses a self-signed development certificate. Trust the .cer file before installation."
    }
}
finally {
    if ($signingCertificate) {
        $signingCertificate.Dispose()
    }
    if ($usingDevelopmentCertificate -and (Test-Path -LiteralPath $temporaryPfxPath)) {
        Remove-Item -LiteralPath $temporaryPfxPath -Force
    }
}
