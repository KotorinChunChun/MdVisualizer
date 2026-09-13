[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$expectedScripts = @(
    "run-debug-MdVisualizer-all.ps1",
    "run-debug-MdVisualizer-all-sample.ps1",
    "run-debug-MdVisualizer-all-smoke.ps1",
    "run-release-MdVisualizer-all.ps1",
    "run-exe-MdVisualizer-all.ps1",
    "run-exe-MdVisualizer-all-sample.ps1",
    "build-release-MdVisualizer-spfx.ps1",
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

$oldDebugSample = Join-Path $projectRoot "dev\scripts\run-debug-test.ps1"
$oldExeSample = Join-Path $projectRoot "dev\scripts\run-release-test.ps1"
if ((Test-Path -LiteralPath $oldDebugSample) -or (Test-Path -LiteralPath $oldExeSample)) {
    throw "dev/scriptsに改名前の起動用スクリプトが残っています。"
}

Write-Host "起動用スクリプトの命名・構文・WhatIfテストが成功しました。"
