[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Import-Module (Join-Path $PSScriptRoot 'NodeRuntime.psm1') -Force
$expectedScripts = @(
    "run-debug-MdVisualizer-all.ps1",
    "run-debug-MdVisualizer-all-sample.ps1",
    "run-debug-MdVisualizer-all-smoke.ps1",
    "run-release-MdVisualizer-all.ps1",
    "run-exe-MdVisualizer-all.ps1",
    "run-exe-MdVisualizer-all-sample.ps1",
    "build-release-MdVisualizer-spfx.ps1",
    "Invoke-MdVisualizerRelease.ps1",
    "plan-release-MdVisualizer.ps1",
    "build-release-MdVisualizer.ps1",
    "stage-release-MdVisualizer.ps1",
    "publish-release-MdVisualizer.ps1",
    "verify-release-MdVisualizer.ps1",
    "full-release-MdVisualizer.ps1",
    "full-release-stable-MdVisualizer.ps1",
    "package-MdVisualizer-msix.ps1",
    "package-MdVisualizer-appinstaller.ps1",
    "publish-release-MdVisualizer-all.ps1",
    "publish-release-MdVisualizer-spfx.ps1",
    "publish-MdVisualizer.ps1"
)
$obsoleteScripts = @(
    "debug-rebuild-smoke.ps1",
    "publish-msix-release.ps1"
)

foreach ($scriptName in $expectedScripts) {
    $scriptPath = Join-Path $PSScriptRoot $scriptName
    if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
        throw "必要なスクリプトがありません: $scriptPath"
    }
}
foreach ($scriptName in $obsoleteScripts) {
    $scriptPath = Join-Path $PSScriptRoot $scriptName
    if (Test-Path -LiteralPath $scriptPath) {
        throw "改名前のスクリプトが残っています: $scriptPath"
    }
}

$launcherNamePattern = '^run-(debug|release|exe)-MdVisualizer-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?\.ps1$'
$launchers = @(Get-ChildItem -LiteralPath $PSScriptRoot -File -Filter "run-*.ps1")
foreach ($launcher in $launchers) {
    if ($launcher.Name -notmatch $launcherNamePattern) {
        throw "起動用スクリプト名が規則外です: $($launcher.Name)"
    }
}

$productEntryPattern = '^(build|run|test|publish)-(debug|release|exe)-MdVisualizer-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?\.ps1$'
foreach ($scriptName in @(
    'build-release-MdVisualizer-spfx.ps1',
    'publish-release-MdVisualizer-all.ps1',
    'publish-release-MdVisualizer-spfx.ps1'
)) {
    if ($scriptName -notmatch $productEntryPattern) {
        throw "製品操作用スクリプト名が規則外です: $scriptName"
    }
}

$releaseEntryPattern = '^(plan|build|stage|publish|verify|full)-release-MdVisualizer\.ps1$'
$releaseEntryModes = @{
    'plan-release-MdVisualizer.ps1' = 'Plan'
    'build-release-MdVisualizer.ps1' = 'Build'
    'stage-release-MdVisualizer.ps1' = 'Stage'
    'publish-release-MdVisualizer.ps1' = 'Publish'
    'verify-release-MdVisualizer.ps1' = 'Verify'
    'full-release-MdVisualizer.ps1' = 'Full'
}
foreach ($entry in $releaseEntryModes.GetEnumerator()) {
    if ($entry.Key -notmatch $releaseEntryPattern) {
        throw "リリース工程用スクリプト名が規則外です: $($entry.Key)"
    }
    $entrySource = Get-Content -LiteralPath (Join-Path $PSScriptRoot $entry.Key) -Raw
    if ($entrySource -notmatch 'Invoke-MdVisualizerRelease\.ps1') {
        throw "共通リリース処理を呼び出していません: $($entry.Key)"
    }
    if ($entrySource -notmatch [regex]::Escape(('Mode = "{0}"' -f $entry.Value))) {
        throw "リリース工程のモード転送が不正です: $($entry.Key)"
    }
    if ($entrySource -notmatch [regex]::Escape('Channel = "beta"')) {
        throw "beta固定のチャンネル転送がありません: $($entry.Key)"
    }
    if ($entrySource -match '\$Channel|\$ConfigPath|\$PythonPath|\$PSBoundParameters|\[switch\]') {
        throw "beta工程入口に利用者向けパラメーターが残っています: $($entry.Key)"
    }
}
$stableEntryPath = Join-Path $PSScriptRoot 'full-release-stable-MdVisualizer.ps1'
$stableEntrySource = Get-Content -LiteralPath $stableEntryPath -Raw
if ($stableEntrySource -notmatch [regex]::Escape('Mode = "Full"') -or
    $stableEntrySource -notmatch [regex]::Escape('Channel = "stable"') -or
    $stableEntrySource -notmatch 'ReleaseIntentConfirmed\s*=\s*\$true' -or
    $stableEntrySource -notmatch 'PublishConfirmed\s*=\s*\$true') {
    throw 'stable一括入口の固定パラメーターが不正です。'
}
if ($stableEntrySource -match '\$Channel|\$ConfigPath|\$PythonPath|\$PSBoundParameters|\[switch\]') {
    throw 'stable一括入口に利用者向けパラメーターが残っています。'
}
$commonReleaseSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Invoke-MdVisualizerRelease.ps1') -Raw
foreach ($mode in @('Plan', 'Build', 'Stage', 'Publish', 'Verify', 'Full')) {
    if ($commonReleaseSource -notmatch [regex]::Escape(('"{0}"' -f $mode))) {
        throw "共通リリース処理にモードがありません: $mode"
    }
}

$parseErrors = [Collections.Generic.List[object]]::new()
Get-ChildItem -LiteralPath $PSScriptRoot -File -Filter "*.ps1" | ForEach-Object {
    $tokens = $null
    $errors = $null
    [Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$errors) | Out-Null
    foreach ($error in @($errors)) {
        $parseErrors.Add([pscustomobject]@{ Script = $_.Name; Message = $error.Message })
    }
}
if ($parseErrors.Count -gt 0) {
    throw "PowerShell構文エラーがあります: $($parseErrors | ConvertTo-Json -Compress)"
}

& (Join-Path $PSScriptRoot "run-debug-MdVisualizer-all.ps1") -WhatIf
& (Join-Path $PSScriptRoot "run-debug-MdVisualizer-all-sample.ps1") -WhatIf
& (Join-Path $PSScriptRoot "run-release-MdVisualizer-all.ps1") -WhatIf
& (Join-Path $PSScriptRoot "run-exe-MdVisualizer-all.ps1") -WhatIf
& (Join-Path $PSScriptRoot "run-exe-MdVisualizer-all-sample.ps1") -WhatIf

$nodeRuntime = Get-MdVisualizerNodeRuntime -ProjectRoot $projectRoot
if (-not (Test-Path -LiteralPath $nodeRuntime.NodeExecutable -PathType Leaf) -or -not (Test-Path -LiteralPath $nodeRuntime.NpmCli -PathType Leaf)) {
    throw 'Node.js/npmの解決結果が不正です。'
}
if ($nodeRuntime.CargoBin -and -not (Test-Path -LiteralPath (Join-Path $nodeRuntime.CargoBin 'cargo.exe') -PathType Leaf)) {
    throw 'Rust/Cargoの解決結果が不正です。'
}

$oldDebugSample = Join-Path $projectRoot "dev\scripts\run-debug-test.ps1"
$oldExeSample = Join-Path $projectRoot "dev\scripts\run-release-test.ps1"
if ((Test-Path -LiteralPath $oldDebugSample) -or (Test-Path -LiteralPath $oldExeSample)) {
    throw "dev/scriptsに改名前の起動用スクリプトが残っています。"
}

Write-Host "起動用スクリプトの命名・構文・WhatIfテストが成功しました。"
