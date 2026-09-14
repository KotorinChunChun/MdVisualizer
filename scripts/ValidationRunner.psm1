Set-StrictMode -Version Latest

function New-MdVisualizerValidationRun {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ProjectRoot, [Parameter(Mandatory)][ValidatePattern('^v\d+\.\d+\.\d+(?:\.\d+)?$')][string]$Version, [Parameter(Mandatory)][string]$RunId, [string[]]$PlannedStages = @())
    if ($RunId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw "実行識別子に使用できない文字があります: $RunId" }
    $root = [IO.Path]::GetFullPath($ProjectRoot); $history = Join-Path $root "dev/history/$Version"
    if (-not (Test-Path -LiteralPath $history -PathType Container)) { throw "対象版の履歴フォルダーがありません: $history" }
    $runDirectory = Join-Path $history "logs/$RunId"
    if (Test-Path -LiteralPath $runDirectory) { throw "同じ実行識別子の出力は上書きしません: $runDirectory" }
    [IO.Directory]::CreateDirectory($runDirectory) | Out-Null
    $steps = [Collections.Generic.List[object]]::new()
    foreach ($planned in $PlannedStages) { $parts = $planned.Split('/', 2); if ($parts.Count -ne 2) { throw "予定段階の形式が不正です: $planned" }; $steps.Add([pscustomobject][ordered]@{ target = $parts[0]; stage = $parts[1]; status = 'not-run'; passed = $false }) }
    [pscustomobject]@{ ProjectRoot = $root; Version = $Version; RunId = $RunId; RunDirectory = $runDirectory; StartedAt = [DateTime]::UtcNow.ToString('o'); Steps = $steps }
}

function Enter-MdVisualizerValidationLock {
    [CmdletBinding()] param([Parameter(Mandatory)][string]$ProjectRoot, [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*$')][string]$Name, [Parameter(Mandatory)][string]$RunId)
    $lockDirectory = Join-Path ([IO.Path]::GetFullPath($ProjectRoot)) '.tools/validation-locks'; [IO.Directory]::CreateDirectory($lockDirectory) | Out-Null; $path = Join-Path $lockDirectory "$Name.lock"
    try { $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) } catch [IO.IOException] { throw "共有生成を含む検証またはビルドが実行中、または未確認のlockが残っています。lockを自動削除しません: $path" }
    $bytes = [Text.Encoding]::UTF8.GetBytes((@{ runId = $RunId; processId = $PID; acquiredAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress)); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true); [pscustomobject]@{ Path = $path; Stream = $stream }
}

function Exit-MdVisualizerValidationLock { [CmdletBinding()] param([Parameter(Mandatory)]$Lock) try { $Lock.Stream.Dispose() } finally { if (Test-Path -LiteralPath $Lock.Path -PathType Leaf) { Remove-Item -LiteralPath $Lock.Path -Force } } }

function Get-MdVisualizerTestResultSummary {
    [CmdletBinding()] param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "テストランナーのJSON結果がありません: $Path" }
    try { $result = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { throw "テストランナーJSONを解析できません: $Path" }
    foreach ($property in @('numTotalTests', 'numPassedTests', 'numFailedTests')) { if ($null -eq $result.$property) { throw "テストランナーJSONに $property がありません: $Path" } }
    $summary = [ordered]@{ path = [IO.Path]::GetFileName($Path); total = [int]$result.numTotalTests; passed = [int]$result.numPassedTests; failed = [int]$result.numFailedTests; success = [bool]$result.success }
    [pscustomobject]$summary
}

function Set-MdVisualizerValidationStep {
    param([Parameter(Mandatory)]$Run, [Parameter(Mandatory)][string]$Target, [Parameter(Mandatory)][string]$Stage, [Parameter(Mandatory)]$Record)
    $entry = @($Run.Steps | Where-Object { $_.target -eq $Target -and $_.stage -eq $Stage }) | Select-Object -First 1
    if ($null -eq $entry) { $Run.Steps.Add($Record); return }; foreach ($property in $Record.PSObject.Properties) { $entry | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value -Force }
}

function Invoke-MdVisualizerValidationProcess {
    [CmdletBinding()] param(
        [Parameter(Mandatory)]$Run,
        [Parameter(Mandatory)][string]$Target,
        [Parameter(Mandatory)][string]$Stage,
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [string]$TestResultPath,
        [switch]$PassThru,
        [ValidateRange(1, 86400)][int]$TimeoutSeconds = 1800
    )
    Write-Host "検証中: $Target/$Stage"
    $safeStage = $Stage -replace '[^A-Za-z0-9._-]', '-'; $stdout = Join-Path $Run.RunDirectory "$Target-$safeStage.stdout.log"; $stderr = Join-Path $Run.RunDirectory "$Target-$safeStage.stderr.log"; $startedAt = [DateTime]::UtcNow; $exitCode = -1; $processError = $null; $timedOut = $false; $process = $null; $stdoutFile = $null; $stderrFile = $null
    try {
        $info = [Diagnostics.ProcessStartInfo]::new(); $info.FileName = $FilePath; $info.WorkingDirectory = [IO.Path]::GetFullPath($WorkingDirectory); $info.UseShellExecute = $false; $info.CreateNoWindow = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
        foreach ($argument in $ArgumentList) { [void]$info.ArgumentList.Add($argument) }; $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
        $stdoutFile = [IO.File]::Open($stdout, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
        $stderrFile = [IO.File]::Open($stderr, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
        if (-not $process.Start()) { throw 'プロセスを開始できませんでした。' }
        # CopyToAsyncは別runspaceを使わず、プロセス実行中からログへ追記する。
        $stdoutCopy = $process.StandardOutput.BaseStream.CopyToAsync($stdoutFile)
        $stderrCopy = $process.StandardError.BaseStream.CopyToAsync($stderrFile)
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $timedOut = $true
            $process.Kill($true)
            $process.WaitForExit()
        }
        $stdoutCopy.GetAwaiter().GetResult() | Out-Null
        $stderrCopy.GetAwaiter().GetResult() | Out-Null
        $exitCode = $process.ExitCode
        if ($timedOut) { $processError = "プロセスが$TimeoutSeconds 秒以内に終了しなかったため、開始した子プロセス木だけを終了しました。" }
    } catch { $processError = $_.Exception.Message }
    finally {
        if ($null -ne $stdoutFile) { $stdoutFile.Dispose() }
        if ($null -ne $stderrFile) { $stderrFile.Dispose() }
        if ($null -ne $process) { $process.Dispose() }
    }
    $testSummary = $null
    $testError = $null
    $testPassed = $true
    if (-not [string]::IsNullOrWhiteSpace($TestResultPath)) {
        try {
            # 非0終了でもJSONを読む。失敗時の実測件数は診断に必要である。
            $testSummary = Get-MdVisualizerTestResultSummary -Path $TestResultPath
            $testPassed = $testSummary.total -gt 0 -and $testSummary.success -and $testSummary.failed -eq 0 -and $testSummary.passed -eq $testSummary.total
            if (-not $testPassed) { $testError = "テストランナーJSONが失敗または未実施です: $TestResultPath" }
        }
        catch { $testPassed = $false; $testError = $_.Exception.Message }
    }
    $passed = $null -eq $processError -and $exitCode -eq 0 -and $testPassed
    $record = [pscustomobject][ordered]@{ target = $Target; stage = $Stage; status = if ($passed) { 'completed' } else { 'failed' }; passed = $passed; command = @($FilePath) + $ArgumentList; workingDirectory = [IO.Path]::GetFullPath($WorkingDirectory); startedAt = $startedAt.ToUniversalTime().ToString('o'); finishedAt = [DateTime]::UtcNow.ToString('o'); exitCode = $exitCode; timedOut = $timedOut; timeoutSeconds = $TimeoutSeconds; processError = $processError; testError = $testError; stdout = [IO.Path]::GetFileName($stdout); stderr = [IO.Path]::GetFileName($stderr); testResult = $testSummary; testResultStatus = if ([string]::IsNullOrWhiteSpace($TestResultPath)) { 'unavailable' } elseif ($null -ne $testSummary -and $testPassed) { 'verified' } elseif ($null -ne $testSummary) { 'failed' } else { 'invalid' } }
    Set-MdVisualizerValidationStep -Run $Run -Target $Target -Stage $Stage -Record $record
    if (-not $record.passed) { throw "[$Target/$Stage] 終了コード $exitCode またはテスト結果で失敗しました。" }
    if ($PassThru) { return $record }
}

function Complete-MdVisualizerValidationRun {
    [CmdletBinding()] param([Parameter(Mandatory)]$Run, [Parameter(Mandatory)][bool]$Passed, [AllowNull()][string]$Failure)
    $notRun = @($Run.Steps | Where-Object { $_.status -eq 'not-run' } | ForEach-Object { "$($_.target)/$($_.stage)" })
    $failed = @($Run.Steps | Where-Object { $_.status -eq 'failed' })
    $summary = [ordered]@{ schemaVersion = 1; runId = $Run.RunId; version = $Run.Version; startedAt = $Run.StartedAt; finishedAt = [DateTime]::UtcNow.ToString('o'); passed = ($Passed -and $notRun.Count -eq 0 -and $failed.Count -eq 0); failure = $Failure; notRunStages = $notRun; steps = @($Run.Steps) }
    $path = Join-Path $Run.RunDirectory 'summary.json'; $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding utf8NoBOM; $path
}

Export-ModuleMember -Function New-MdVisualizerValidationRun, Enter-MdVisualizerValidationLock, Exit-MdVisualizerValidationLock, Get-MdVisualizerTestResultSummary, Invoke-MdVisualizerValidationProcess, Complete-MdVisualizerValidationRun
