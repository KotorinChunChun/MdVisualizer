# =============================================================================
#  軽量リリース exe 更新スクリプト
#  - Tauri の Release exe だけを生成する（インストーラー、ZIP、GitHub Release は作らない）
#  - 書き込み可能な既存 exe、または release ショートカットのリンク先を更新する
#  - MSIX の WindowsApps 配下は Windows の保護対象なので直接更新しない
#
#  通常実行:
#    pwsh -NoProfile -File .\dev\scripts\release-MarkdownViewer.ps1
#
#  更新先を明示する場合:
#    pwsh -NoProfile -File .\dev\scripts\release-MarkdownViewer.ps1 `
#      -InstalledExePath "$env:LOCALAPPDATA\Programs\MarkdownViewer\MarkdownViewer.exe"
# =============================================================================
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$InstalledExePath,
    [string]$BuiltExePath,
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not $BuiltExePath) {
    $BuiltExePath = Join-Path $ProjectRoot 'src-tauri\target\release\markdown-viewer.exe'
}
$BuiltExePath = [System.IO.Path]::GetFullPath($BuiltExePath)

function Test-IsWindowsAppsPath {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    $windowsAppsRoot = Join-Path $env:ProgramFiles 'WindowsApps'
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    return $fullPath.StartsWith(
        $windowsAppsRoot.TrimEnd('\') + '\',
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

function Get-DisplayIconPath {
    param([AllowNull()][string]$DisplayIcon)

    if ([string]::IsNullOrWhiteSpace($DisplayIcon)) {
        return $null
    }

    $candidate = $DisplayIcon.Trim().Trim('"')
    $candidate = $candidate -replace ',\s*-?\d+$', ''
    return $candidate.Trim().Trim('"')
}

function Find-InstalledExecutable {
    $processPath = Get-Process -Name 'markdown-viewer', 'MarkdownViewer' -ErrorAction SilentlyContinue |
        ForEach-Object {
            try { $_.Path } catch { $null }
        } |
        Where-Object { $_ -and -not (Test-IsWindowsAppsPath -Path $_) } |
        Select-Object -First 1
    if ($processPath) {
        return [pscustomobject]@{ Path = $processPath; Source = '実行中プロセス' }
    }

    $registryRoots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    $installedApp = Get-ItemProperty $registryRoots -ErrorAction SilentlyContinue |
        Where-Object {
            $_.PSObject.Properties['DisplayName'] -and
            $_.DisplayName -match '^Markdown\s*Viewer$|^MarkdownViewer$'
        } |
        Select-Object -First 1
    if ($installedApp) {
        $candidates = [System.Collections.Generic.List[string]]::new()
        $displayIcon = if ($installedApp.PSObject.Properties['DisplayIcon']) {
            $installedApp.DisplayIcon
        }
        else {
            $null
        }
        $displayIconPath = Get-DisplayIconPath -DisplayIcon $displayIcon
        if ($displayIconPath) {
            $candidates.Add($displayIconPath)
        }
        $installLocation = if ($installedApp.PSObject.Properties['InstallLocation']) {
            $installedApp.InstallLocation
        }
        else {
            $null
        }
        if (-not [string]::IsNullOrWhiteSpace($installLocation)) {
            $candidates.Add((Join-Path $installLocation 'MarkdownViewer.exe'))
            $candidates.Add((Join-Path $installLocation 'markdown-viewer.exe'))
        }

        $registryExe = $candidates |
            Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
            Select-Object -First 1
        if ($registryExe) {
            return [pscustomobject]@{ Path = $registryExe; Source = 'アンインストール情報' }
        }
    }

    $shortcutRoots = @(
        [Environment]::GetFolderPath('Desktop'),
        [Environment]::GetFolderPath('CommonDesktopDirectory')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) }
    $releaseShortcut = Get-ChildItem -LiteralPath $shortcutRoots -Filter '*.lnk' -ErrorAction SilentlyContinue |
        Where-Object { $_.BaseName -match '(?i)markdown.?viewer.*release|release.*markdown.?viewer' } |
        Select-Object -First 1
    if ($releaseShortcut) {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($releaseShortcut.FullName)
        if ($shortcut.TargetPath) {
            return [pscustomobject]@{ Path = $shortcut.TargetPath; Source = 'release ショートカット' }
        }
    }

    $msixPackage = Get-AppxPackage -Name 'com.markdownviewer.viewer' -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($msixPackage) {
        throw @"
インストール済みの MarkdownViewer は MSIX 版です。
MSIX の exe は WindowsApps の保護対象なので直接差し替えできません。
書き込み可能なポータブル版のパスを -InstalledExePath で指定するか、MSIX 更新用スクリプトを使用してください。
MSIX: $($msixPackage.PackageFullName)
"@
    }

    throw '更新対象の MarkdownViewer.exe を検出できませんでした。-InstalledExePath で既存 exe のパスを指定してください。'
}

function Assert-ApplicationStopped {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $usingProcesses = Get-Process -Name 'markdown-viewer', 'MarkdownViewer' -ErrorAction SilentlyContinue |
        Where-Object {
            try {
                [System.IO.Path]::GetFullPath($_.Path).Equals(
                    $fullPath,
                    [System.StringComparison]::OrdinalIgnoreCase
                )
            }
            catch {
                $false
            }
        }
    if ($usingProcesses) {
        $processIds = ($usingProcesses.Id | Sort-Object) -join ', '
        throw "MarkdownViewer が実行中です。アプリを終了してから再実行してください。PID: $processIds"
    }
}

function New-BackupPath {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmssfff'
    return "$Path.backup-$timestamp"
}

if ($InstalledExePath) {
    $resolvedTarget = [pscustomobject]@{
        Path = [System.IO.Path]::GetFullPath($InstalledExePath)
        Source = '-InstalledExePath'
    }
}
else {
    $resolvedTarget = Find-InstalledExecutable
    $resolvedTarget.Path = [System.IO.Path]::GetFullPath($resolvedTarget.Path)
}

if (Test-IsWindowsAppsPath -Path $resolvedTarget.Path) {
    throw 'MSIX の WindowsApps 配下にある exe は直接差し替えできません。MSIX 更新用スクリプトを使用してください。'
}
if (-not (Test-Path -LiteralPath $resolvedTarget.Path -PathType Leaf)) {
    throw "更新対象の exe が存在しません: $($resolvedTarget.Path)"
}

Assert-ApplicationStopped -Path $resolvedTarget.Path
if (
    -not $BuiltExePath.Equals($resolvedTarget.Path, [System.StringComparison]::OrdinalIgnoreCase) -and
    (Test-Path -LiteralPath $BuiltExePath -PathType Leaf)
) {
    Assert-ApplicationStopped -Path $BuiltExePath
}

$samePath = $BuiltExePath.Equals(
    $resolvedTarget.Path,
    [System.StringComparison]::OrdinalIgnoreCase
)
$backupPath = $null

Write-Host '========================================================' -ForegroundColor Cyan
Write-Host ' MarkdownViewer 軽量 Release exe 更新' -ForegroundColor Cyan
Write-Host " ビルド出力: $BuiltExePath" -ForegroundColor Green
Write-Host " 更新対象:   $($resolvedTarget.Path)" -ForegroundColor Yellow
Write-Host " 検出方法:   $($resolvedTarget.Source)" -ForegroundColor DarkGray
Write-Host '========================================================' -ForegroundColor Cyan

if ($resolvedTarget.Source -eq 'release ショートカット' -and -not $WhatIfPreference) {
    $installedMsixPackage = Get-AppxPackage -Name 'com.markdownviewer.viewer' -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($installedMsixPackage) {
        Write-Warning 'このPCのスタートメニュー版はMSIXです。今回更新するのはデスクトップのreleaseショートカットが参照するexeだけです。'
    }
}

if (-not $SkipBuild) {
    if (-not $PSCmdlet.ShouldProcess($BuiltExePath, 'Tauri Release exe を生成')) {
        Write-Host 'WhatIf のためビルドと差し替えを実行しませんでした。' -ForegroundColor Gray
        return
    }

    if ($samePath) {
        $backupPath = New-BackupPath -Path $resolvedTarget.Path
        Copy-Item -LiteralPath $resolvedTarget.Path -Destination $backupPath
        Write-Host "ビルド前の exe をバックアップしました: $backupPath" -ForegroundColor DarkGray
    }

    Push-Location $ProjectRoot
    try {
        Write-Host 'Tauri Release exe を生成しています（バンドル生成なし）...' -ForegroundColor Yellow
        & npm run tauri build -- --no-bundle
        if ($LASTEXITCODE -ne 0) {
            throw "Tauri Release ビルドに失敗しました。終了コード: $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath $BuiltExePath -PathType Leaf)) {
    throw "生成済みの Release exe が見つかりません: $BuiltExePath"
}

if ($samePath) {
    $hash = (Get-FileHash -LiteralPath $BuiltExePath -Algorithm SHA256).Hash
    Write-Host 'Release exe の生成が完了しました。ショートカットのリンク先は更新済みです。' -ForegroundColor Green
    if ($backupPath) {
        Write-Host "バックアップ: $backupPath" -ForegroundColor DarkGray
    }
    Write-Host "SHA-256: $hash" -ForegroundColor DarkGray
    return
}

if (-not $PSCmdlet.ShouldProcess($resolvedTarget.Path, '既存 exe をバックアップして Release exe に差し替え')) {
    Write-Host 'WhatIf のため exe の差し替えを実行しませんでした。' -ForegroundColor Gray
    return
}

$targetDirectory = Split-Path -Parent $resolvedTarget.Path
$temporaryTarget = Join-Path $targetDirectory ".markdown-viewer-update-$PID.exe"
$backupPath = New-BackupPath -Path $resolvedTarget.Path
try {
    Copy-Item -LiteralPath $BuiltExePath -Destination $temporaryTarget -Force
    $sourceHash = (Get-FileHash -LiteralPath $BuiltExePath -Algorithm SHA256).Hash
    $temporaryHash = (Get-FileHash -LiteralPath $temporaryTarget -Algorithm SHA256).Hash
    if ($sourceHash -ne $temporaryHash) {
        throw '一時コピーの SHA-256 がビルド済み exe と一致しません。'
    }

    [System.IO.File]::Replace($temporaryTarget, $resolvedTarget.Path, $backupPath, $true)
    $installedHash = (Get-FileHash -LiteralPath $resolvedTarget.Path -Algorithm SHA256).Hash
    if ($sourceHash -ne $installedHash) {
        throw '差し替え後の exe の SHA-256 がビルド済み exe と一致しません。'
    }
}
finally {
    if (Test-Path -LiteralPath $temporaryTarget) {
        Remove-Item -LiteralPath $temporaryTarget -Force
    }
}

Write-Host 'Release exe の生成と差し替えが完了しました。' -ForegroundColor Green
Write-Host "更新先:     $($resolvedTarget.Path)" -ForegroundColor Green
Write-Host "バックアップ: $backupPath" -ForegroundColor DarkGray
Write-Host "SHA-256:    $sourceHash" -ForegroundColor DarkGray
