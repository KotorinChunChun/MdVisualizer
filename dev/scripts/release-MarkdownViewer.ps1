# =============================================================================
#  デバッグ用 MSIX exe 更新スクリプト
#  - Tauri の Release exe だけを生成する（MSIX、ZIP、インストーラーは作らない）
#  - 登録済みMSIXのInstallLocation配下からexeを特定し、バイナリだけを強制置換する
#  - WindowsApps内の変更はパッケージ署名を壊すため、開発PCでのデバッグ専用
#
#  通常実行:
#    pwsh -NoProfile -File .\dev\scripts\release-MarkdownViewer.ps1
# =============================================================================
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$InstalledExePath,
    [string]$BuiltExePath,
    [switch]$SkipBuild,
    [switch]$ElevatedMsixOverwrite
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$PackageIdentityName = 'com.markdownviewer.viewer'
if (-not $BuiltExePath) {
    $BuiltExePath = Join-Path $ProjectRoot 'src-tauri\target\release\markdown-viewer.exe'
}
$BuiltExePath = [System.IO.Path]::GetFullPath($BuiltExePath)

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

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

function Get-MsixExecutableCandidates {
    param(
        [Parameter(Mandatory)]
        [string]$InstallLocation
    )

    $root = [System.IO.Path]::GetFullPath($InstallLocation)
    return @(
        Get-ChildItem -LiteralPath $root -File -Recurse -ErrorAction Stop |
            Where-Object { $_.Name -ieq 'markdown-viewer.exe' } |
            Where-Object {
                $_.FullName.StartsWith(
                    $root.TrimEnd('\') + '\',
                    [System.StringComparison]::OrdinalIgnoreCase
                )
            }
    )
}

function Find-InstalledMsixExecutable {
    param([string]$ExpectedPath)

    $packages = @(
        Get-AppxPackage -Name $PackageIdentityName -ErrorAction SilentlyContinue |
            Sort-Object Version -Descending
    )
    if ($packages.Count -eq 0) {
        throw "MSIX版 $PackageIdentityName が現在のユーザーへインストールされていません。"
    }

    foreach ($package in $packages) {
        $candidates = @(Get-MsixExecutableCandidates -InstallLocation $package.InstallLocation)
        if ($ExpectedPath) {
            $expectedFullPath = [System.IO.Path]::GetFullPath($ExpectedPath)
            $matched = $candidates |
                Where-Object {
                    $_.FullName.Equals($expectedFullPath, [System.StringComparison]::OrdinalIgnoreCase)
                } |
                Select-Object -First 1
            if ($matched) {
                return [pscustomobject]@{
                    Path = $matched.FullName
                    PackageFullName = $package.PackageFullName
                    InstallLocation = $package.InstallLocation
                }
            }
            continue
        }

        if ($candidates.Count -eq 1) {
            return [pscustomobject]@{
                Path = $candidates[0].FullName
                PackageFullName = $package.PackageFullName
                InstallLocation = $package.InstallLocation
            }
        }
        if ($candidates.Count -gt 1) {
            throw "MSIX配下にmarkdown-viewer.exeが複数見つかったため対象を確定できません: $($package.InstallLocation)"
        }
    }

    if ($ExpectedPath) {
        throw "指定されたWindowsApps内exeは、登録済み $PackageIdentityName パッケージの実行ファイルではありません: $ExpectedPath"
    }
    throw "登録済みMSIXの配下にmarkdown-viewer.exeが見つかりませんでした: $($packages[0].InstallLocation)"
}

function Assert-MarkdownViewerStopped {
    $usingProcesses = @(
        Get-Process -Name 'markdown-viewer', 'MarkdownViewer' -ErrorAction SilentlyContinue
    )
    if ($usingProcesses.Count -gt 0) {
        $processIds = ($usingProcesses.Id | Sort-Object) -join ', '
        throw "MarkdownViewer が実行中です。アプリを終了してから再実行してください。PID: $processIds"
    }
}

function New-BackupPath {
    param(
        [Parameter(Mandatory)]
        [string]$PackageFullName
    )

    $safePackageName = $PackageFullName -replace '[^A-Za-z0-9._-]', '_'
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmssfff'
    $backupDirectory = Join-Path $ProjectRoot "release\msix-debug-backup\$safePackageName\$timestamp"
    New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
    return Join-Path $backupDirectory 'markdown-viewer.exe'
}

function Invoke-CheckedNativeCommand {
    param(
        [Parameter(Mandatory)]
        [string]$FilePath,
        [Parameter(Mandatory)]
        [string[]]$ArgumentList
    )

    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "管理者コマンドに失敗しました。終了コード ${LASTEXITCODE}: $FilePath"
    }
}

function Invoke-MsixExecutableOverwrite {
    param(
        [Parameter(Mandatory)]
        [pscustomobject]$Target,
        [Parameter(Mandatory)]
        [string]$SourcePath
    )

    if (-not (Test-IsAdministrator)) {
        throw 'WindowsApps内のexeを上書きするには管理者権限が必要です。'
    }

    Assert-MarkdownViewerStopped
    $sourceHash = (Get-FileHash -LiteralPath $SourcePath -Algorithm SHA256).Hash
    $backupPath = New-BackupPath -PackageFullName $Target.PackageFullName
    Copy-Item -LiteralPath $Target.Path -Destination $backupPath -Force
    $originalHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash
    $originalAcl = Get-Acl -LiteralPath $Target.Path
    $currentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $aclChanged = $false

    try {
        Invoke-CheckedNativeCommand -FilePath 'takeown.exe' -ArgumentList @('/F', $Target.Path, '/A')
        Invoke-CheckedNativeCommand `
            -FilePath 'icacls.exe' `
            -ArgumentList @($Target.Path, '/grant:r', "*${currentUserSid}:(F)")
        $aclChanged = $true

        Copy-Item -LiteralPath $SourcePath -Destination $Target.Path -Force
        $installedHash = (Get-FileHash -LiteralPath $Target.Path -Algorithm SHA256).Hash
        if ($sourceHash -ne $installedHash) {
            throw '差し替え後のWindowsApps内exeのSHA-256がRelease exeと一致しません。'
        }
    }
    catch {
        try {
            Copy-Item -LiteralPath $backupPath -Destination $Target.Path -Force
        }
        catch {
            Write-Warning "上書き失敗後の自動復元にも失敗しました。バックアップを使用してください: $backupPath"
        }
        throw
    }
    finally {
        if ($aclChanged) {
            try {
                Set-Acl -LiteralPath $Target.Path -AclObject $originalAcl
            }
            catch {
                Write-Warning "WindowsApps内exeの元のACLを復元できませんでした: $($_.Exception.Message)"
            }
        }
    }

    return [pscustomobject]@{
        BackupPath = $backupPath
        OriginalHash = $originalHash
        InstalledHash = $sourceHash
    }
}

function ConvertTo-ProcessArgument {
    param([Parameter(Mandatory)][string]$Value)
    return '"' + $Value.Replace('"', '\"') + '"'
}

function Invoke-ElevatedMsixOverwrite {
    param(
        [Parameter(Mandatory)]
        [pscustomobject]$Target
    )

    $pwshPath = (Get-Process -Id $PID).Path
    $arguments = @(
        '-NoProfile',
        '-File', (ConvertTo-ProcessArgument -Value $PSCommandPath),
        '-SkipBuild',
        '-BuiltExePath', (ConvertTo-ProcessArgument -Value $BuiltExePath),
        '-InstalledExePath', (ConvertTo-ProcessArgument -Value $Target.Path),
        '-ElevatedMsixOverwrite'
    )
    $process = Start-Process `
        -FilePath $pwshPath `
        -ArgumentList $arguments `
        -Verb RunAs `
        -Wait `
        -PassThru
    if ($process.ExitCode -ne 0) {
        if ((Test-Path -LiteralPath $BuiltExePath -PathType Leaf) -and
            (Test-Path -LiteralPath $Target.Path -PathType Leaf)) {
            $sourceHash = (Get-FileHash -LiteralPath $BuiltExePath -Algorithm SHA256).Hash
            $installedHash = (Get-FileHash -LiteralPath $Target.Path -Algorithm SHA256).Hash
            if ($sourceHash -eq $installedHash) {
                Write-Warning "管理者プロセスは終了コード $($process.ExitCode) を返しましたが、差し替え先のSHA-256はRelease exeと一致しています。差し替え成功として継続します。"
                return
            }
        }
        throw "管理者権限でのMSIX exe差し替えに失敗しました。終了コード: $($process.ExitCode)"
    }
}

if ($InstalledExePath) {
    if (Test-IsWindowsAppsPath -Path $InstalledExePath) {
        $resolvedTarget = Find-InstalledMsixExecutable -ExpectedPath $InstalledExePath
    }
    else {
        throw '-InstalledExePathで指定できるのは、登録済みMarkdownViewer MSIX配下のexeだけです。'
    }
}
else {
    $resolvedTarget = Find-InstalledMsixExecutable
}

Write-Host '========================================================' -ForegroundColor Cyan
Write-Host ' MarkdownViewer デバッグ用 MSIX exe 更新' -ForegroundColor Cyan
Write-Host " ビルド出力: $BuiltExePath" -ForegroundColor Green
Write-Host " 更新対象:   $($resolvedTarget.Path)" -ForegroundColor Yellow
Write-Host " パッケージ: $($resolvedTarget.PackageFullName)" -ForegroundColor DarkGray
Write-Host '========================================================' -ForegroundColor Cyan
Write-Warning 'WindowsApps内のexeだけを置換するため、MSIXの署名整合性は失われます。開発PCでのデバッグ以外には使用しないでください。'

if (-not $SkipBuild) {
    if (-not $PSCmdlet.ShouldProcess($BuiltExePath, 'Tauri Release exe を生成')) {
        Write-Host 'WhatIf のためビルドと差し替えを実行しませんでした。' -ForegroundColor Gray
        return
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
    throw "生成済みのRelease exeが見つかりません: $BuiltExePath"
}

if (-not $PSCmdlet.ShouldProcess($resolvedTarget.Path, 'MSIX内exeをバックアップしてRelease exeで強制上書き')) {
    Write-Host 'WhatIf のためMSIX内exeの差し替えを実行しませんでした。' -ForegroundColor Gray
    return
}

Assert-MarkdownViewerStopped

if (-not (Test-IsAdministrator)) {
    if ($ElevatedMsixOverwrite) {
        throw '管理者権限への昇格に失敗しました。'
    }
    Write-Host 'WindowsApps内exeの置換部分だけを管理者権限で再実行します。' -ForegroundColor Yellow
    Invoke-ElevatedMsixOverwrite -Target $resolvedTarget
    Write-Host 'Release exeの生成とMSIX内exeの差し替えが完了しました。' -ForegroundColor Green
    return
}

$result = Invoke-MsixExecutableOverwrite -Target $resolvedTarget -SourcePath $BuiltExePath
Write-Host 'Release exeの生成とMSIX内exeの差し替えが完了しました。' -ForegroundColor Green
Write-Host "更新先:       $($resolvedTarget.Path)" -ForegroundColor Green
Write-Host "バックアップ: $($result.BackupPath)" -ForegroundColor DarkGray
Write-Host "更新前SHA-256: $($result.OriginalHash)" -ForegroundColor DarkGray
Write-Host "更新後SHA-256: $($result.InstalledHash)" -ForegroundColor DarkGray
