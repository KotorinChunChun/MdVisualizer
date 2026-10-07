[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$orchestratorPath = Join-Path $PSScriptRoot "publish-release-MdVisualizer-all.ps1"
$commonOrchestratorPath = Join-Path $PSScriptRoot "Invoke-MdVisualizerRelease.ps1"
$releaseDirectory = Join-Path $projectRoot "release\msix"
$websiteDownloadDirectory = "C:\develop\excel-chunchun\www\download"

function Get-DirectoryFingerprint {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return "MISSING"
    }
    return (Get-ChildItem -LiteralPath $Path -File -Recurse -Force |
        Sort-Object FullName |
        ForEach-Object { "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" }) -join "`n"
}

function Assert-BlockedBeforeWork {
    param(
        [Parameter(Mandatory)]
        [string]$Mode,
        [Parameter(Mandatory)]
        [string]$ExpectedMessage,
        [switch]$ReleaseIntentConfirmed
    )

    $caughtMessage = $null
    try {
        if ($ReleaseIntentConfirmed) {
            & $orchestratorPath -Mode $Mode -Channel beta -ReleaseIntentConfirmed
        }
        else {
            & $orchestratorPath -Mode $Mode -Channel beta
        }
    }
    catch {
        $caughtMessage = $_.Exception.Message
    }
    if ([string]::IsNullOrWhiteSpace($caughtMessage)) {
        throw "Mode $Mode was expected to be blocked before work started."
    }
    if (-not $caughtMessage.Contains($ExpectedMessage)) {
        throw "Mode $Mode returned an unexpected safety error: $caughtMessage"
    }
}

$releaseFingerprintBefore = Get-DirectoryFingerprint -Path $releaseDirectory
$websiteFingerprintBefore = Get-DirectoryFingerprint -Path $websiteDownloadDirectory
$releaseToolsPath = Join-Path $PSScriptRoot "ReleaseTools.psm1"
Import-Module $releaseToolsPath -Force
$configuration = Import-ReleaseConfiguration -ProjectRoot $projectRoot
$historyVersion = Get-ConfiguredHistoryVersion -Configuration $configuration
$publicVersion = [string]$configuration.Raw.application.publicVersion
$packageVersion = [string]$configuration.Raw.application.packageVersion
$publicMatch = [regex]::Match($publicVersion, '^(\d+\.\d+\.\d+)\.(\d+) beta$')
$packageMatch = [regex]::Match($packageVersion, '^(\d+\.\d+\.\d+)\+beta\.(\d+)$')
if (-not $publicMatch.Success -or -not $packageMatch.Success) { throw "beta版の版表記が不正です: $publicVersion / $packageVersion" }
if ($historyVersion -ne "v$($publicMatch.Groups[1].Value)") { throw "履歴版の決定結果が不正です: $historyVersion" }
$expectedMsixVersion = "$($publicMatch.Groups[1].Value).$($publicMatch.Groups[2].Value)"
if ($packageMatch.Groups[1].Value -ne $publicMatch.Groups[1].Value -or $packageMatch.Groups[2].Value -ne $publicMatch.Groups[2].Value -or [string]$configuration.Raw.application.msixVersion -ne $expectedMsixVersion) {
    throw "beta版の公開版・内部版・MSIX版が一致していません。"
}
foreach ($channel in @("beta", "stable")) {
    $artifacts = Get-ReleaseArtifacts -Configuration $configuration -Channel $channel
    if ($artifacts.PublicVersion -ne $publicVersion -or $artifacts.ApplicationVersion -ne $packageVersion -or $artifacts.PackageVersion -ne $expectedMsixVersion) {
        throw "公開表示版・内部版・MSIX版の対応が不正です: $($artifacts.PublicVersion) / $($artifacts.ApplicationVersion) / $($artifacts.PackageVersion)"
    }
    if ($artifacts.CertificateFileName -ne "MdVisualizer.cer") {
        throw "The public certificate file name is not stable for ${channel}: $($artifacts.CertificateFileName)"
    }
    if ([System.IO.Path]::GetFileName($artifacts.StagedCertificatePath) -ne "MdVisualizer.cer") {
        throw "The staged public certificate file name is not stable for ${channel}."
    }
}
$temporaryCertificateDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "MdVisualizer-certificate-test-$PID"
$temporaryCertificatePath = Join-Path $temporaryCertificateDirectory "MdVisualizer.cer"
try {
    $initialBytes = [System.Text.Encoding]::UTF8.GetBytes("same certificate")
    if (-not (Set-FileBytesIfChanged -Path $temporaryCertificatePath -Bytes $initialBytes)) {
        throw "The initial certificate test file was not written."
    }
    $fixedTimestamp = [DateTime]::UtcNow.AddDays(-1)
    [System.IO.File]::SetLastWriteTimeUtc($temporaryCertificatePath, $fixedTimestamp)
    if (Set-FileBytesIfChanged -Path $temporaryCertificatePath -Bytes $initialBytes) {
        throw "An unchanged certificate was unexpectedly rewritten."
    }
    if ([System.IO.File]::GetLastWriteTimeUtc($temporaryCertificatePath) -ne $fixedTimestamp) {
        throw "The unchanged certificate timestamp was modified."
    }
    if (-not (Set-FileBytesIfChanged `
        -Path $temporaryCertificatePath `
        -Bytes ([System.Text.Encoding]::UTF8.GetBytes("replacement certificate")))) {
        throw "A changed certificate was not rewritten."
    }
}
finally {
    if (Test-Path -LiteralPath $temporaryCertificateDirectory) {
        $resolvedTemporary = [IO.Path]::GetFullPath($temporaryCertificateDirectory)
        $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if (-not $resolvedTemporary.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedTemporary) -ne "MdVisualizer-certificate-test-$PID") { throw '削除対象が証明書試験専用フォルダーではありません。' }
        Remove-Item -LiteralPath $temporaryCertificateDirectory -Recurse -Force
    }
}
$planOutput = (& $orchestratorPath -Mode Plan 6>&1 | Out-String)
if (-not $planOutput.Contains("NO BUILD, INSTALLER GENERATION, STAGING, UPLOAD, OR INSTALLATION WAS STARTED.")) {
    throw "Plan mode did not emit the no-work safety marker."
}
$namedPlanOutput = (& (Join-Path $PSScriptRoot "plan-release-MdVisualizer.ps1") 6>&1 | Out-String)
if (-not $namedPlanOutput.Contains("NO BUILD, INSTALLER GENERATION, STAGING, UPLOAD, OR INSTALLATION WAS STARTED.")) {
    throw "The named Plan entry point did not emit the no-work safety marker."
}

Assert-BlockedBeforeWork -Mode Build -ExpectedMessage "ReleaseIntentConfirmed"
Assert-BlockedBeforeWork -Mode Stage -ExpectedMessage "ReleaseIntentConfirmed"
Assert-BlockedBeforeWork -Mode Publish -ExpectedMessage "ReleaseIntentConfirmed"
Assert-BlockedBeforeWork `
    -Mode Publish `
    -ExpectedMessage "PublishConfirmed" `
    -ReleaseIntentConfirmed
Assert-BlockedBeforeWork -Mode Full -ExpectedMessage "ReleaseIntentConfirmed"
$stableBlocked = $false
try { & (Join-Path $PSScriptRoot 'full-release-stable-MdVisualizer.ps1') }
catch { $stableBlocked = $_.Exception.Message.Contains('stableリリースを開始できません') }
if (-not $stableBlocked) { throw 'beta設定のままstable一括入口が開始されました。' }

$portableBlocked = $false
try { & (Join-Path $PSScriptRoot 'package-MdVisualizer-portable.ps1') }
catch { $portableBlocked = $_.Exception.Message.Contains('ReleaseIntentConfirmed') }
if (!$portableBlocked) { throw 'ポータブル版の無承認生成を防げませんでした。' }
$publishSource = Get-Content -LiteralPath $commonOrchestratorPath -Raw
if ($publishSource -match '@\(\$configuration.FtpUploadScriptPath,\s*(?:"--dry-run",\s*)?\$configuration.SiteDirectory\)') {
    throw '配布ルート全体を送信する呼び出しは禁止です。製品ファイル一覧を使用してください。'
}

$releaseFingerprintAfter = Get-DirectoryFingerprint -Path $releaseDirectory
$websiteFingerprintAfter = Get-DirectoryFingerprint -Path $websiteDownloadDirectory
if ($releaseFingerprintBefore -ne $releaseFingerprintAfter) {
    throw "Release automation self-test changed the release directory."
}
if ($websiteFingerprintBefore -ne $websiteFingerprintAfter) {
    throw "Release automation self-test changed the website download directory."
}

Write-Host "Release automation safety tests passed."
Write-Host "No build, installer generation, staging, upload, or installation was started."
