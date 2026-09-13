[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet("beta", "stable")]
    [string]$Channel,
    [string]$ConfigPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot "ReleaseTools.psm1") -Force
$configuration = Import-ReleaseConfiguration -Path $ConfigPath -ProjectRoot $projectRoot
$artifacts = Get-ReleaseArtifacts -Configuration $configuration -Channel $Channel

foreach ($localArtifact in @(
    $artifacts.StagedPackagePath,
    $artifacts.StagedCertificatePath,
    $artifacts.StagedAppInstallerPath
)) {
    if (-not (Test-Path -LiteralPath $localArtifact -PathType Leaf)) {
        throw "Local staged artifact is required for published verification: $localArtifact"
    }
}

$httpClient = [System.Net.Http.HttpClient]::new()
try {
    $headChecks = @(
        [pscustomobject]@{
            Uri = $configuration.Raw.distribution.publicDownloadPage
            ContentType = "text/html"
        },
        [pscustomobject]@{
            Uri = $artifacts.AppInstallerUri
            ContentType = "application/appinstaller"
        },
        [pscustomobject]@{
            Uri = $artifacts.PackageUri
            ContentType = "application/msix"
        },
        [pscustomobject]@{
            Uri = $artifacts.Channel.BaseUri + $artifacts.CertificateFileName
            ContentType = "application/pkix-cert"
        }
    )

    foreach ($check in $headChecks) {
        $request = [System.Net.Http.HttpRequestMessage]::new(
            [System.Net.Http.HttpMethod]::Head,
            $check.Uri
        )
        try {
            $response = $httpClient.SendAsync($request).GetAwaiter().GetResult()
            try {
                if (-not $response.IsSuccessStatusCode) {
                    throw "Published URL returned HTTP $([int]$response.StatusCode): $($check.Uri)"
                }
                $contentType = $response.Content.Headers.ContentType.MediaType
                if ($contentType -ne $check.ContentType) {
                    throw "Unexpected Content-Type for $($check.Uri): $contentType"
                }
                if (-not $response.Content.Headers.ContentLength -or $response.Content.Headers.ContentLength -le 0) {
                    throw "Published URL does not return a valid Content-Length: $($check.Uri)"
                }
                Write-Host "HTTP OK: $($check.Uri) [$contentType] $($response.Content.Headers.ContentLength) bytes"
            }
            finally {
                $response.Dispose()
            }
        }
        finally {
            $request.Dispose()
        }
    }

    $remotePackageBytes = $httpClient.GetByteArrayAsync($artifacts.PackageUri).GetAwaiter().GetResult()
    $remoteCertificateBytes = $httpClient.GetByteArrayAsync(
        $artifacts.Channel.BaseUri + $artifacts.CertificateFileName
    ).GetAwaiter().GetResult()
    $remoteAppInstallerBytes = $httpClient.GetByteArrayAsync(
        $artifacts.AppInstallerUri
    ).GetAwaiter().GetResult()

    $remotePackageHash = [Convert]::ToHexString(
        [System.Security.Cryptography.SHA256]::HashData($remotePackageBytes)
    )
    $remoteCertificateHash = [Convert]::ToHexString(
        [System.Security.Cryptography.SHA256]::HashData($remoteCertificateBytes)
    )
    $localPackageHash = (Get-FileHash -LiteralPath $artifacts.StagedPackagePath -Algorithm SHA256).Hash
    $localCertificateHash = (Get-FileHash -LiteralPath $artifacts.StagedCertificatePath -Algorithm SHA256).Hash
    if ($remotePackageHash -ne $localPackageHash) {
        throw "Published MSIX hash does not match the staged release."
    }
    if ($remoteCertificateHash -ne $localCertificateHash) {
        throw "Published CER hash does not match the staged release."
    }
    $portableName = "MdVisualizer_$($artifacts.ApplicationVersion)_x64_portable.zip"
    $portableUri = $artifacts.Channel.BaseUri + $portableName
    $portableResponse = $httpClient.GetAsync($portableUri).GetAwaiter().GetResult()
    try {
        $portableResponse.EnsureSuccessStatusCode() | Out-Null
        if ($portableResponse.Content.Headers.ContentType.MediaType -notin @('application/zip', 'application/x-zip-compressed')) { throw '公開ZIPのMIMEが不正です。' }
        $portableBytes = $portableResponse.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        if ($portableResponse.Content.Headers.ContentLength -ne $portableBytes.Length) { throw '公開ZIPのContent-Lengthが一致しません。' }
        $portableHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($portableBytes))
        if ($portableHash -ne (Get-FileHash (Join-Path $artifacts.Channel.SiteDirectory $portableName) -Algorithm SHA256).Hash) { throw '公開ZIPのハッシュが一致しません。' }
        Write-Host "Portable ZIP HTTP/MIME/Length/SHA256 OK: $portableUri $portableHash"
    } finally { $portableResponse.Dispose() }

    $appInstallerText = [System.Text.Encoding]::UTF8.GetString($remoteAppInstallerBytes)
    [xml]$publishedAppInstaller = $appInstallerText
    $rootNode = $publishedAppInstaller.SelectSingleNode("/*[local-name()='AppInstaller']")
    $mainPackage = $publishedAppInstaller.SelectSingleNode(
        "/*[local-name()='AppInstaller']/*[local-name()='MainPackage']"
    )
    if (
        -not $rootNode -or
        -not $mainPackage -or
        $rootNode.GetAttribute("Uri") -ne $artifacts.AppInstallerUri -or
        $mainPackage.GetAttribute("Uri") -ne $artifacts.PackageUri -or
        $mainPackage.GetAttribute("Version") -ne $artifacts.PackageVersion
    ) {
        throw "Published App Installer does not match the configured $Channel release."
    }

    Write-Host "Published $Channel release verification passed."
    Write-Host "MSIX SHA256: $remotePackageHash"
    Write-Host "CER SHA256: $remoteCertificateHash"
}
finally {
    $httpClient.Dispose()
}
