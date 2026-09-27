#Requires -Version 7.0

[CmdletBinding()]
param(
    [ValidateSet('Desktop', 'Web', 'SPFx', 'Static')]
    [string[]]$Target = @('Static', 'Desktop', 'Web', 'SPFx'),
    [string]$Version,
    [string]$RunId = "validation-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1') -Force
$configuration = Import-ReleaseConfiguration -ProjectRoot $projectRoot
$configuredVersion = Get-ConfiguredHistoryVersion -Configuration $configuration
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = $configuredVersion
    Write-Host "検証対象版をrelease-config.jsonから決定しました: $Version"
}
elseif ($Version -ne $configuredVersion) {
    throw "指定Versionがrelease-config.jsonから決定した対象版と一致しません: $Version / $configuredVersion"
}
Import-Module (Join-Path $PSScriptRoot 'ValidationRunner.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'NodeRuntime.psm1') -Force

function Assert-Node22Runtime {
    param($Runtime)
    $version = (& $Runtime.NodeExecutable --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v22\.') {
        throw "Node.js 22 が必要です。検出結果: $version"
    }
}

function Invoke-NpmStage {
    param($Run, [string]$TargetName, [string]$Stage, $Runtime, [string[]]$Arguments, [string]$WorkingDirectory, [string]$TestResultPath)
    Invoke-MdVisualizerValidationProcess -Run $Run -Target $TargetName -Stage $Stage `
        -FilePath $Runtime.NodeExecutable -ArgumentList (@($Runtime.NpmCli) + $Arguments) `
        -WorkingDirectory $WorkingDirectory -TestResultPath $TestResultPath
}

$plans = @{
    Desktop = @('vitest-json', 'frontend-build', 'rust-tests')
    Web = @('vitest-json', 'web-build')
    SPFx = @('embedded-tools', 'heft-test', 'production-package')
    Static = @('shared-check', 'source-boundaries', 'ui-contract', 'command-contract', 'block-semantics', 'block-self-test', 'development-docs', 'root-connection', 'typescript')
}
$plannedStages = foreach ($selected in $Target) {
    foreach ($stage in $plans[$selected]) { "$selected/$stage" }
}
$run = New-MdVisualizerValidationRun -ProjectRoot $projectRoot -Version $Version -RunId $RunId -PlannedStages $plannedStages
$lock = $null
$previousPath = $env:PATH

try {
    $runtime = Get-MdVisualizerNodeRuntime -ProjectRoot $projectRoot
    Assert-Node22Runtime $runtime
    $env:PATH = "$(Split-Path $runtime.NodeExecutable);$previousPath"
    # 各ホストが共有生成物を更新するため、対象別ではなく統合実行全体を一つのlockで保護する。
    $lock = Enter-MdVisualizerValidationLock -ProjectRoot $projectRoot -Name 'shared-build' -RunId $run.RunId

    foreach ($selected in $Target) {
        switch ($selected) {
            'Desktop' {
                $json = Join-Path $run.RunDirectory 'Desktop-vitest.json'
                Invoke-MdVisualizerValidationProcess -Run $run -Target $selected -Stage 'vitest-json' -FilePath $runtime.NodeExecutable -ArgumentList @((Join-Path $projectRoot 'node_modules/vitest/vitest.mjs'), 'run', '--maxWorkers=2', '--reporter=json', '--outputFile', $json) -WorkingDirectory $projectRoot -TestResultPath $json | Out-Null
                Invoke-NpmStage $run $selected 'frontend-build' $runtime @('run', 'build') $projectRoot $null | Out-Null
                if (-not $runtime.CargoBin) { throw 'Cargo が見つからないためDesktop Rust検証を開始できません。' }
                Invoke-MdVisualizerValidationProcess -Run $run -Target $selected -Stage 'rust-tests' -FilePath (Join-Path $runtime.CargoBin 'cargo.exe') -ArgumentList @('test', '--manifest-path', (Join-Path $projectRoot 'src-tauri/Cargo.toml'), '--lib', '--locked') -WorkingDirectory $projectRoot | Out-Null
            }
            'Web' {
                $web = Join-Path $projectRoot 'web-platform'
                $json = Join-Path $run.RunDirectory 'Web-vitest.json'
                Invoke-MdVisualizerValidationProcess -Run $run -Target $selected -Stage 'vitest-json' -FilePath $runtime.NodeExecutable -ArgumentList @((Join-Path $web 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'apps/web/vitest.config.ts', '--maxWorkers=2', '--reporter=json', '--outputFile', $json) -WorkingDirectory $web -TestResultPath $json | Out-Null
                Invoke-MdVisualizerValidationProcess -Run $run -Target $selected -Stage 'web-build' -FilePath $runtime.NodeExecutable -ArgumentList @((Join-Path $web 'scripts/build-web.mjs')) -WorkingDirectory $web | Out-Null
            }
            'SPFx' {
                $web = Join-Path $projectRoot 'web-platform'
                Invoke-MdVisualizerValidationProcess -Run $run -Target $selected -Stage 'embedded-tools' -FilePath $runtime.NodeExecutable -ArgumentList @((Join-Path $PSScriptRoot 'build-embedded-tools.mjs')) -WorkingDirectory $projectRoot | Out-Null
                # Heftの終了コードで判定し、実JSONがない件数はunavailableとする。
                Invoke-MdVisualizerValidationProcess -Run $run -Target $selected -Stage 'heft-test' -FilePath $runtime.NodeExecutable -ArgumentList @((Join-Path $web 'scripts/run-spfx.mjs'), 'test', '--clean', '--production', '--disable-code-coverage', '--max-workers', '2') -WorkingDirectory $projectRoot | Out-Null
                Invoke-MdVisualizerValidationProcess -Run $run -Target $selected -Stage 'production-package' -FilePath $runtime.NodeExecutable -ArgumentList @((Join-Path $web 'scripts/run-spfx.mjs'), 'package-solution', '--production') -WorkingDirectory $projectRoot | Out-Null
            }
            'Static' {
                $web = Join-Path $projectRoot 'web-platform'
                Invoke-NpmStage $run $selected 'shared-check' $runtime @('run', 'check:shared') $projectRoot $null | Out-Null
                Invoke-MdVisualizerValidationProcess -Run $run -Target $selected -Stage 'source-boundaries' -FilePath $runtime.NodeExecutable -ArgumentList @((Join-Path $web 'scripts/check-source-boundaries.mjs')) -WorkingDirectory $web | Out-Null
                Invoke-MdVisualizerValidationProcess -Run $run -Target $selected -Stage 'ui-contract' -FilePath $runtime.NodeExecutable -ArgumentList @((Join-Path $web 'scripts/check-ui-styles.mjs')) -WorkingDirectory $web | Out-Null
                Invoke-MdVisualizerValidationProcess -Run $run -Target $selected -Stage 'command-contract' -FilePath $runtime.NodeExecutable -ArgumentList @((Join-Path $PSScriptRoot 'ui-command-contract.mjs')) -WorkingDirectory $projectRoot | Out-Null
                Invoke-MdVisualizerValidationProcess -Run $run -Target $selected -Stage 'block-semantics' -FilePath $runtime.NodeExecutable -ArgumentList @((Join-Path $PSScriptRoot 'check-block-command-semantics.mjs')) -WorkingDirectory $projectRoot | Out-Null
                Invoke-MdVisualizerValidationProcess -Run $run -Target $selected -Stage 'block-self-test' -FilePath $runtime.NodeExecutable -ArgumentList @((Join-Path $PSScriptRoot 'test-block-command-semantics.mjs')) -WorkingDirectory $projectRoot | Out-Null
                Invoke-MdVisualizerValidationProcess -Run $run -Target $selected -Stage 'development-docs' -FilePath $runtime.NodeExecutable -ArgumentList @((Join-Path $PSScriptRoot 'check-development-docs.mjs'), $Version) -WorkingDirectory $projectRoot | Out-Null
                Invoke-NpmStage $run $selected 'root-connection' $runtime @('run', 'test:web-platform') $projectRoot $null | Out-Null
                Invoke-MdVisualizerValidationProcess -Run $run -Target $selected -Stage 'typescript' -FilePath $runtime.NodeExecutable -ArgumentList @((Join-Path $projectRoot 'node_modules/typescript/bin/tsc'), '--noEmit') -WorkingDirectory $projectRoot | Out-Null
            }
        }
    }
    $summary = Complete-MdVisualizerValidationRun -Run $run -Passed $true -Failure $null
    Write-Host "統合検証に成功しました: $summary"
}
catch {
    $summary = Complete-MdVisualizerValidationRun -Run $run -Passed $false -Failure $_.Exception.Message
    Write-Error "統合検証に失敗しました: $($_.Exception.Message)`n結果: $summary"
    exit 1
}
finally {
    $env:PATH = $previousPath
    if ($null -ne $lock) { Exit-MdVisualizerValidationLock -Lock $lock }
}
