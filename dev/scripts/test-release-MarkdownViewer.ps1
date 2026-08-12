[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'release-MarkdownViewer.ps1'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) "MarkdownViewer-release-script-$PID"
$sourcePath = Join-Path $testRoot 'build\markdown-viewer.exe'
$targetPath = Join-Path $testRoot 'installed\MarkdownViewer.exe'

try {
    New-Item -ItemType Directory -Path (Split-Path -Parent $sourcePath) -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null
    [System.IO.File]::WriteAllText($sourcePath, 'new release executable')
    [System.IO.File]::WriteAllText($targetPath, 'old installed executable')

    & $scriptPath -SkipBuild -BuiltExePath $sourcePath -InstalledExePath $targetPath

    $updatedContent = [System.IO.File]::ReadAllText($targetPath)
    if ($updatedContent -ne 'new release executable') {
        throw '既存 exe がビルド済み exe の内容へ更新されませんでした。'
    }

    $backups = @(Get-ChildItem -LiteralPath (Split-Path -Parent $targetPath) -Filter 'MarkdownViewer.exe.backup-*')
    if ($backups.Count -ne 1) {
        throw "バックアップ数が1件ではありません: $($backups.Count)"
    }
    if ([System.IO.File]::ReadAllText($backups[0].FullName) -ne 'old installed executable') {
        throw 'バックアップに差し替え前の内容が保存されていません。'
    }

    $samePathOutput = (& $scriptPath -SkipBuild -BuiltExePath $sourcePath -InstalledExePath $sourcePath 6>&1 | Out-String)
    if (-not $samePathOutput.Contains('リンク先は更新済みです')) {
        throw 'ビルド出力と更新先が同一の場合の完了メッセージを確認できませんでした。'
    }

    $windowsAppsError = $null
    try {
        & $scriptPath `
            -SkipBuild `
            -BuiltExePath $sourcePath `
            -InstalledExePath (Join-Path $env:ProgramFiles 'WindowsApps\fake\MarkdownViewer.exe')
    }
    catch {
        $windowsAppsError = $_.Exception.Message
    }
    if (-not $windowsAppsError -or -not $windowsAppsError.Contains('直接差し替えできません')) {
        throw 'WindowsApps 配下の直接差し替えが拒否されませんでした。'
    }

    Write-Host '軽量 Release exe 更新スクリプトのテストに成功しました。' -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
