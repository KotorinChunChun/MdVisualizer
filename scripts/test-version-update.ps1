#Requires -Version 7.0
# バージョン更新入口の入力変換と事前検査を、ファイル変更なしで検証する。
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $PSScriptRoot 'update-version-MdVisualizer.ps1'
$releaseConfig = Get-Content -LiteralPath (Join-Path $projectRoot 'packaging/release-config.json') -Raw | ConvertFrom-Json
$currentMsixVersion = [string]$releaseConfig.application.msixVersion
$currentMatch = [regex]::Match($currentMsixVersion, '^(\d+)\.(\d+)\.(\d+)\.(\d+)$')
if (-not $currentMatch.Success) { throw "現在のMSIX版が4桁ではありません: $currentMsixVersion" }
$currentParts = @($currentMatch.Groups[1].Value, $currentMatch.Groups[2].Value, $currentMatch.Groups[3].Value, $currentMatch.Groups[4].Value) | ForEach-Object { [int]$_ }
if ($currentParts[3] -lt 65535) {
    $targetParts = @($currentParts[0], $currentParts[1], $currentParts[2], ($currentParts[3] + 1))
}
else {
    $targetParts = @($currentParts[0], $currentParts[1], ($currentParts[2] + 1), 0)
}
$targetVersion = $targetParts -join '.'
$targetBaseVersion = "$($targetParts[0]).$($targetParts[1]).$($targetParts[2])"
$targetPackageVersion = "$targetBaseVersion+beta.$($targetParts[3])"
$targetPublicVersion = "$targetVersion beta"
$historyVersion = "v$($currentParts[0]).$($currentParts[1]).$($currentParts[2])"
$oldVersions = @(
    [string]$releaseConfig.application.publicVersion,
    [string]$releaseConfig.application.packageVersion,
    [string]$releaseConfig.application.msixVersion
)
$output = & $scriptPath -ProjectRoot $projectRoot -TargetVersion $targetVersion -WhatIf *>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "バージョン更新のWhatIf検査に失敗しました。`n$output" }
foreach ($expected in @($targetPublicVersion, $targetPackageVersion, $targetVersion, $historyVersion)) {
    if (-not $output.Contains($expected)) { throw "WhatIf出力に変換結果がありません: $expected`n$output" }
}

$invalidSucceeded = $true
try {
    $invalid = & $scriptPath -ProjectRoot $projectRoot -TargetVersion '0.0.18' -WhatIf *>&1 | Out-String
}
catch {
    $invalidSucceeded = $false
    $invalid = $_ | Out-String
}
if ($invalidSucceeded -or -not $invalid.Contains('入力版が不正です')) {
    throw "不正な4桁版の拒否に失敗しました。`n$invalid"
}

$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) "MdVisualizer-version-update-$PID"
function Copy-FixtureFile {
    param([Parameter(Mandatory)][string]$RelativePath)
    $source = Join-Path $projectRoot $RelativePath
    $destination = Join-Path $fixtureRoot $RelativePath
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
}

try {
    foreach ($relativePath in @(
        'packaging/release-config.json',
        'packaging/site/index.html',
        'packaging/site/MdVisualizer.html',
        'package.json',
        'package-lock.json',
        'src-tauri/tauri.conf.json',
        'src-tauri/Cargo.toml',
        'src-tauri/Cargo.lock',
        'scripts/NodeRuntime.psm1',
        'scripts/update-version-MdVisualizer.ps1',
        'web-platform/targets.json',
        'web-platform/package.json',
        'web-platform/package-lock.json',
        'web-platform/packages/markdown-core/package.json',
        'web-platform/apps/web/src/targetVersions.generated.ts',
        'web-platform/apps/spfx/package.json',
        'web-platform/apps/spfx/package-lock.json',
        'web-platform/apps/spfx/config/package-solution.json',
        'web-platform/scripts/generate-targets.mjs'
    )) {
        Copy-FixtureFile -RelativePath $relativePath
    }
    New-Item -ItemType Directory -Path (Join-Path $fixtureRoot "dev/history/$historyVersion") -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $fixtureRoot 'empty.md') -Force | Out-Null

    $fixtureScript = Join-Path $fixtureRoot 'scripts/update-version-MdVisualizer.ps1'
    $fixtureOutput = & $fixtureScript -ProjectRoot $fixtureRoot -TargetVersion $targetVersion -Yes *>&1 | Out-String
    if (-not $?) { throw "fixtureの実更新に失敗しました。`n$fixtureOutput" }
    $fixtureConfig = Get-Content -LiteralPath (Join-Path $fixtureRoot 'packaging/release-config.json') -Raw | ConvertFrom-Json
    if ($fixtureConfig.application.publicVersion -ne $targetPublicVersion -or
        $fixtureConfig.application.packageVersion -ne $targetPackageVersion -or
        $fixtureConfig.application.msixVersion -ne $targetVersion) {
        throw "fixtureの変換結果が不正です。`n$fixtureOutput"
    }
    $fixtureLogs = @(Get-ChildItem -LiteralPath (Join-Path $fixtureRoot "dev/history/$historyVersion/logs/version-update") -Filter '*.log' -File)
    if ($fixtureLogs.Count -ne 1) { throw "fixtureのNode.js実行ログが1件ではありません: $($fixtureLogs.Count)" }
    $oldVersionResidues = Get-ChildItem -LiteralPath $fixtureRoot -File -Recurse |
        Select-String -SimpleMatch -Pattern $oldVersions
    if ($oldVersionResidues) {
        throw "fixtureに旧版残骸があります。`n$($oldVersionResidues | Out-String)"
    }
}
finally {
    if (Test-Path -LiteralPath $fixtureRoot) {
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
    }
}
Write-Host 'version update: 入力変換・事前検査・不正入力拒否の検証成功'
