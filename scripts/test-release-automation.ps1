[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$orchestratorPath = Join-Path $PSScriptRoot "publish-msix-release.ps1"
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
$planOutput = (& $orchestratorPath -Mode Plan 6>&1 | Out-String)
if (-not $planOutput.Contains("NO BUILD, INSTALLER GENERATION, STAGING, UPLOAD, OR INSTALLATION WAS STARTED.")) {
    throw "Plan mode did not emit the no-work safety marker."
}

Assert-BlockedBeforeWork -Mode Build -ExpectedMessage "ReleaseIntentConfirmed"
Assert-BlockedBeforeWork -Mode Stage -ExpectedMessage "ReleaseIntentConfirmed"
Assert-BlockedBeforeWork -Mode Publish -ExpectedMessage "ReleaseIntentConfirmed"
Assert-BlockedBeforeWork `
    -Mode Publish `
    -ExpectedMessage "PublishConfirmed" `
    -ReleaseIntentConfirmed
Assert-BlockedBeforeWork -Mode Full -ExpectedMessage "ReleaseIntentConfirmed"

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
