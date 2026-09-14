#Requires -Version 7.0
[CmdletBinding()] param()
Set-StrictMode -Version Latest; $ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot; Import-Module (Join-Path $PSScriptRoot 'ValidationRunner.psm1') -Force
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) "mdvisualizer validation runner $([guid]::NewGuid().ToString('N'))"
try {
    foreach ($versionDirectory in @('v0.0.18', 'v0.0.18.1')) { [IO.Directory]::CreateDirectory((Join-Path $fixtureRoot "dev/history/$versionDirectory")) | Out-Null }
    $passJson = Join-Path $fixtureRoot 'pass.json'; @{ success = $true; numTotalTests = 3; numPassedTests = 3; numFailedTests = 0 } | ConvertTo-Json | Set-Content -LiteralPath $passJson -Encoding utf8NoBOM
    $run = New-MdVisualizerValidationRun -ProjectRoot $fixtureRoot -Version 'v0.0.18.1' -RunId 'fixture-success' -PlannedStages @('Fixture/success')
    $ok = Invoke-MdVisualizerValidationProcess -Run $run -Target 'Fixture' -Stage 'success' -FilePath (Join-Path $PSHOME 'pwsh.exe') -ArgumentList @('-NoProfile', '-Command', 'Write-Output "space value"; exit 0') -WorkingDirectory $fixtureRoot -TestResultPath $passJson -PassThru
    if (-not $ok.passed -or $ok.testResult.total -ne 3 -or (Get-Content -LiteralPath (Join-Path $run.RunDirectory $ok.stdout) -Raw).Trim() -ne 'space value') { throw '成功プロセスまたはVitest/Jest形式JSONを成功として集計できません。' }
    $successSummaryPath = Complete-MdVisualizerValidationRun -Run $run -Passed $true -Failure $null; $successSummary = Get-Content -LiteralPath $successSummaryPath -Raw | ConvertFrom-Json
    if (-not $successSummary.passed -or $successSummary.notRunStages.Count -ne 0) { throw '完了済み段階を成功として集計できません。' }
    $duplicateRunRejected = $false; try { New-MdVisualizerValidationRun -ProjectRoot $fixtureRoot -Version 'v0.0.18.1' -RunId 'fixture-success' | Out-Null } catch { $duplicateRunRejected = $true }; if (-not $duplicateRunRejected) { throw '同一RunIdの上書きを拒否できません。' }

    $failJson = Join-Path $fixtureRoot 'fail.json'; @{ success = $false; numTotalTests = 3; numPassedTests = 2; numFailedTests = 1 } | ConvertTo-Json | Set-Content -LiteralPath $failJson -Encoding utf8NoBOM
    $failedRun = New-MdVisualizerValidationRun -ProjectRoot $fixtureRoot -Version 'v0.0.18' -RunId 'fixture-failure' -PlannedStages @('Fixture/json-failure', 'Fixture/after-failure')
    $failed = $false; try { Invoke-MdVisualizerValidationProcess -Run $failedRun -Target 'Fixture' -Stage 'json-failure' -FilePath (Join-Path $PSHOME 'pwsh.exe') -ArgumentList @('-NoProfile', '-Command', 'exit 7') -WorkingDirectory $fixtureRoot -TestResultPath $failJson } catch { $failed = $true }
    if (-not $failed -or $failedRun.Steps[0].status -ne 'failed' -or $failedRun.Steps[0].testResult.failed -ne 1 -or $failedRun.Steps[0].testResult.passed -ne 2) { throw '非0終了でも失敗JSONの実測件数を記録できません。' }
    $failureSummaryPath = Complete-MdVisualizerValidationRun -Run $failedRun -Passed $true -Failure 'fixture failure'; $failureSummary = Get-Content -LiteralPath $failureSummaryPath -Raw | ConvertFrom-Json
    if ($failureSummary.passed -or $failureSummary.notRunStages -notcontains 'Fixture/after-failure') { throw '失敗後の未実施段階を記録できません。' }

    $jsonOnlyFailureRun = New-MdVisualizerValidationRun -ProjectRoot $fixtureRoot -Version 'v0.0.18' -RunId 'fixture-json-only-failure' -PlannedStages @('Fixture/json-only-failure')
    $jsonOnlyFailed = $false; try { Invoke-MdVisualizerValidationProcess -Run $jsonOnlyFailureRun -Target 'Fixture' -Stage 'json-only-failure' -FilePath (Join-Path $PSHOME 'pwsh.exe') -ArgumentList @('-NoProfile', '-Command', 'exit 0') -WorkingDirectory $fixtureRoot -TestResultPath $failJson } catch { $jsonOnlyFailed = $true }
    if (-not $jsonOnlyFailed -or $jsonOnlyFailureRun.Steps[0].exitCode -ne 0 -or $jsonOnlyFailureRun.Steps[0].testResult.failed -ne 1) { throw '終了コード0でも失敗JSONを拒否できません。' }

    $timeoutRun = New-MdVisualizerValidationRun -ProjectRoot $fixtureRoot -Version 'v0.0.18' -RunId 'fixture-timeout' -PlannedStages @('Fixture/timeout')
    $timedOut = $false; try { Invoke-MdVisualizerValidationProcess -Run $timeoutRun -Target 'Fixture' -Stage 'timeout' -FilePath (Join-Path $PSHOME 'pwsh.exe') -ArgumentList @('-NoProfile', '-Command', 'Write-Output "started"; Start-Sleep -Seconds 3') -WorkingDirectory $fixtureRoot -TimeoutSeconds 1 } catch { $timedOut = $true }
    $timeoutLog = Join-Path $timeoutRun.RunDirectory $timeoutRun.Steps[0].stdout
    if (-not $timedOut -or -not $timeoutRun.Steps[0].timedOut -or $timeoutRun.Steps[0].status -ne 'failed' -or -not (Test-Path -LiteralPath $timeoutLog)) { throw '短時間timeoutの終了・失敗記録・ログ保存を確認できません。' }

    $firstLock = Enter-MdVisualizerValidationLock -ProjectRoot $fixtureRoot -Name 'shared-build' -RunId 'fixture-lock-a'
    try { $duplicateRejected = $false; try { Enter-MdVisualizerValidationLock -ProjectRoot $fixtureRoot -Name 'shared-build' -RunId 'fixture-lock-b' | Out-Null } catch { $duplicateRejected = $true }; if (-not $duplicateRejected) { throw '重複lockを拒否できません。' } } finally { Exit-MdVisualizerValidationLock -Lock $firstLock }
    Write-Host 'ValidationRunner: JSON成功・終了コード0失敗JSON・非0終了件数・timeout・空白引数・RunId・重複lock・未実施の9項目成功'
} finally { if (Test-Path -LiteralPath $fixtureRoot) { $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot); $expectedPrefix = Join-Path ([IO.Path]::GetTempPath()) 'mdvisualizer validation runner '; if (-not $resolvedFixture.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'fixture削除先が作業用一時領域外です。' }; Remove-Item -LiteralPath $resolvedFixture -Recurse -Force } }
