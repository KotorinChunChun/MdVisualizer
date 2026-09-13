param(
  [string]$ExePath = "C:\develop\MdVisualizer\src-tauri\target\release\mdvisualizer.exe",
  [int]$Runs = 5
)

$samplePath = Join-Path ([System.IO.Path]::GetTempPath()) "mdvisualizer-perf-10000.md"
$line = "- Performance test line with **Markdown** and `code`." + [Environment]::NewLine
[System.IO.File]::WriteAllText($samplePath, ($line * 10000), [System.Text.UTF8Encoding]::new($false))

try {
  $measurements = for ($i = 1; $i -le $Runs; $i++) {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process -FilePath $ExePath -ArgumentList $samplePath -PassThru
    do { Start-Sleep -Milliseconds 25; $process.Refresh() } while ($process.MainWindowHandle -eq 0 -and $watch.ElapsedMilliseconds -lt 15000)
    $watch.Stop()
    if ($process.MainWindowHandle -eq 0) { throw "Run $i did not create a main window." }
    $workingSetMb = [math]::Round($process.WorkingSet64 / 1MB, 1)
    $null = $process.CloseMainWindow()
    Start-Sleep -Milliseconds 500
    if (!$process.HasExited) { Stop-Process -Id $process.Id -Force }
    [PSCustomObject]@{ Run = $i; StartupMs = $watch.ElapsedMilliseconds; WorkingSetMB = $workingSetMb }
  }
  $measurements | Format-Table -AutoSize
  [PSCustomObject]@{
    StartupMedianMs = ($measurements.StartupMs | Sort-Object)[[math]::Floor(($measurements.Count - 1) / 2)]
    StartupMaxMs = ($measurements.StartupMs | Measure-Object -Maximum).Maximum
    WorkingSetMaxMB = ($measurements.WorkingSetMB | Measure-Object -Maximum).Maximum
  } | Format-List
} finally {
  Remove-Item -LiteralPath $samplePath -Force -ErrorAction SilentlyContinue
}
