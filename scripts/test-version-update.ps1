#Requires -Version 7.0
# バージョン更新入口の入力変換と事前検査を、ファイル変更なしで検証する。
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $PSScriptRoot 'update-version-MdVisualizer.ps1'
$output = & $scriptPath -ProjectRoot $projectRoot -TargetVersion '0.0.18.2' -WhatIf *>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "バージョン更新のWhatIf検査に失敗しました。`n$output" }
foreach ($expected in @('0.0.18.2 beta', '0.0.18+beta.2', '0.0.18.2', 'v0.0.18')) {
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
    New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'dev/history/v0.0.18') -Force | Out-Null

    $fixtureScript = Join-Path $fixtureRoot 'scripts/update-version-MdVisualizer.ps1'
    $fixtureOutput = & $fixtureScript -ProjectRoot $fixtureRoot -TargetVersion '0.0.18.2' -Yes *>&1 | Out-String
    if (-not $?) { throw "fixtureの実更新に失敗しました。`n$fixtureOutput" }
    $fixtureConfig = Get-Content -LiteralPath (Join-Path $fixtureRoot 'packaging/release-config.json') -Raw | ConvertFrom-Json
    if ($fixtureConfig.application.publicVersion -ne '0.0.18.2 beta' -or
        $fixtureConfig.application.packageVersion -ne '0.0.18+beta.2' -or
        $fixtureConfig.application.msixVersion -ne '0.0.18.2') {
        throw "fixtureの変換結果が不正です。`n$fixtureOutput"
    }
    $oldVersionResidues = Get-ChildItem -LiteralPath $fixtureRoot -File -Recurse |
        Select-String -SimpleMatch -Pattern @('0.0.18.1 beta', '0.0.18+beta.1', '0.0.18.1')
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
