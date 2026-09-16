#Requires -Version 7.0
# MdVisualizerのbeta版を入力版へ更新し、関連版情報を検査する。
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$TargetVersion,
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$Yes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRootFullPath = [IO.Path]::GetFullPath($ProjectRoot)
$releaseConfigPath = Join-Path $projectRootFullPath 'packaging\release-config.json'
$packageJsonPath = Join-Path $projectRootFullPath 'package.json'
$packageLockPath = Join-Path $projectRootFullPath 'package-lock.json'
$tauriConfigPath = Join-Path $projectRootFullPath 'src-tauri\tauri.conf.json'
$cargoTomlPath = Join-Path $projectRootFullPath 'src-tauri\Cargo.toml'
$cargoLockPath = Join-Path $projectRootFullPath 'src-tauri\Cargo.lock'
$webRoot = Join-Path $projectRootFullPath 'web-platform'
$webTargetsPath = Join-Path $webRoot 'targets.json'
$webGeneratedPath = Join-Path $webRoot 'apps\web\src\targetVersions.generated.ts'
$webSpfxPackagePath = Join-Path $webRoot 'apps\spfx\package.json'
$webSpfxLockPath = Join-Path $webRoot 'apps\spfx\package-lock.json'
$webSolutionPath = Join-Path $webRoot 'apps\spfx\config\package-solution.json'
$webPackagePath = Join-Path $webRoot 'package.json'
$webPackageLockPath = Join-Path $webRoot 'package-lock.json'
$webMarkdownCorePackagePath = Join-Path $webRoot 'packages\markdown-core\package.json'
$siteFiles = @(
    (Join-Path $projectRootFullPath 'packaging\site\index.html'),
    (Join-Path $projectRootFullPath 'packaging\site\MdVisualizer.html')
)

function Assert-FileExists {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "必要なファイルがありません: $Path"
    }
}

function Read-JsonFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [switch]$AsHashtable
    )
    Assert-FileExists -Path $Path
    if ($AsHashtable) {
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable
    }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function ConvertTo-JsonText {
    param([Parameter(Mandatory)]$Value)
    return "$(ConvertTo-Json -InputObject $Value -Depth 100)$("`n")"
}

function Write-TextFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Content
    )
    $encoding = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Get-JsonMapValue {
    param(
        [Parameter(Mandatory)]$Object,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Name
    )
    if ($Object -is [Collections.IDictionary]) {
        if (-not $Object.Contains($Name)) { throw "JSONプロパティがありません: $Name" }
        return $Object[$Name]
    }
    $property = $Object.PSObject.Properties[$Name]
    if (-not $property) { throw "JSONプロパティがありません: $Name" }
    return $property.Value
}

function Compare-VersionParts {
    param(
        [Parameter(Mandatory)][int[]]$Left,
        [Parameter(Mandatory)][int[]]$Right
    )
    for ($index = 0; $index -lt 4; $index++) {
        if ($Left[$index] -lt $Right[$index]) { return -1 }
        if ($Left[$index] -gt $Right[$index]) { return 1 }
    }
    return 0
}

function ConvertTo-VersionParts {
    param([Parameter(Mandatory)][string]$Version)
    $match = [regex]::Match($Version.Trim(), '^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')
    if (-not $match.Success) {
        throw "入力版が不正です。4桁の数値版（例: 1.2.3.4 または v1.2.3.4）を指定してください: $Version"
    }

    $parts = @(
        [int]$match.Groups[1].Value,
        [int]$match.Groups[2].Value,
        [int]$match.Groups[3].Value,
        [int]$match.Groups[4].Value
    )
    if ($parts | Where-Object { $_ -gt 65535 }) {
        throw "各版番号は0から65535までで指定してください: $Version"
    }
    return $parts
}

function New-VersionPlan {
    param(
        [Parameter(Mandatory)][string]$Target,
        [Parameter(Mandatory)][string]$CurrentMsixVersion
    )
    $targetParts = ConvertTo-VersionParts -Version $Target
    $currentParts = ConvertTo-VersionParts -Version $CurrentMsixVersion
    if ((Compare-VersionParts -Left $targetParts -Right $currentParts) -le 0) {
        throw "入力版は現在版より新しくしてください。現在: $CurrentMsixVersion / 入力: $Target"
    }

    $baseVersion = "$($targetParts[0]).$($targetParts[1]).$($targetParts[2])"
    $msixVersion = $targetParts -join '.'
    return [pscustomobject]@{
        MsixVersion = $msixVersion
        PublicVersion = "$msixVersion beta"
        PackageVersion = "$baseVersion+beta.$($targetParts[3])"
        HistoryVersion = "v$baseVersion"
        Parts = $targetParts
    }
}

function Get-VersionSnapshot {
    $release = Read-JsonFile -Path $releaseConfigPath
    $package = Read-JsonFile -Path $packageJsonPath
    $packageLock = Read-JsonFile -Path $packageLockPath -AsHashtable
    $tauri = Read-JsonFile -Path $tauriConfigPath
    $targets = Read-JsonFile -Path $webTargetsPath
    $spfx = Read-JsonFile -Path $webSpfxPackagePath
    $solution = Read-JsonFile -Path $webSolutionPath

    $cargo = Get-Content -LiteralPath $cargoTomlPath -Raw
    $cargoLock = Get-Content -LiteralPath $cargoLockPath -Raw
    $cargoMatch = [regex]::Match($cargo, '(?ms)^\[package\]\s*\r?\nname = "mdvisualizer"\s*\r?\nversion = "([^"]+)"')
    $cargoLockMatch = [regex]::Match($cargoLock, '(?ms)^\[\[package\]\]\s*\r?\nname = "mdvisualizer"\s*\r?\nversion = "([^"]+)"')
    if (-not $cargoMatch.Success -or -not $cargoLockMatch.Success) {
        throw 'Cargo.tomlまたはCargo.lockからmdvisualizerの版を取得できません。'
    }

    [pscustomobject]@{
        ReleaseConfig = $release
        Package = $package
        PackageLock = $packageLock
        Tauri = $tauri
        Targets = $targets
        Spfx = $spfx
        Solution = $solution
        CargoVersion = $cargoMatch.Groups[1].Value
        CargoLockVersion = $cargoLockMatch.Groups[1].Value
        PublicVersion = [string]$release.application.publicVersion
        PackageVersion = [string]$release.application.packageVersion
        MsixVersion = [string]$release.application.msixVersion
    }
}

function Assert-VersionSnapshot {
    param([Parameter(Mandatory)]$Snapshot)

    $publicMatch = [regex]::Match($Snapshot.PublicVersion, '^(\d+\.\d+\.\d+)\.(\d+) beta$')
    $packageMatch = [regex]::Match($Snapshot.PackageVersion, '^(\d+\.\d+\.\d+)\+beta\.(\d+)$')
    if (-not $publicMatch.Success -or -not $packageMatch.Success) {
        throw "release-config.jsonのbeta版表記が不正です。"
    }
    if ($publicMatch.Groups[1].Value -ne $packageMatch.Groups[1].Value -or
        $publicMatch.Groups[2].Value -ne $packageMatch.Groups[2].Value -or
        $Snapshot.MsixVersion -ne "$($publicMatch.Groups[1].Value).$($publicMatch.Groups[2].Value)") {
        throw 'release-config.json内の公開版・内部版・MSIX版が一致していません。'
    }

    $expectedPackageVersion = $Snapshot.PackageVersion
    $checks = [ordered]@{
        'package.json' = [string]$Snapshot.Package.version
        'tauri.conf.json' = [string]$Snapshot.Tauri.version
        'Cargo.toml' = $Snapshot.CargoVersion
        'Cargo.lock' = $Snapshot.CargoLockVersion
        'web-platform/targets.json sharedVersion' = [string]$Snapshot.Targets.sharedVersion
        'web-platform/targets.json html' = [string]$Snapshot.Targets.targets.html.version
        'web-platform/targets.json php' = [string]$Snapshot.Targets.targets.php.version
        'web-platform/targets.json spfx' = [string]$Snapshot.Targets.targets.spfx.version
        'web-platform/apps/spfx/package.json' = [string]$Snapshot.Spfx.version
        'web-platform/apps/spfx/package-solution.json' = [string]$Snapshot.Solution.solution.version
    }
    foreach ($entry in $checks.GetEnumerator()) {
        $expected = if ($entry.Key -eq 'web-platform/apps/spfx/package-solution.json') { $Snapshot.MsixVersion } else { $expectedPackageVersion }
        if ($entry.Value -ne $expected) {
            throw "$($entry.Key)の版がrelease-config.jsonと一致していません: $($entry.Value) / $expected"
        }
    }

    $lockPackages = Get-JsonMapValue -Object $Snapshot.PackageLock -Name 'packages'
    foreach ($key in @('', 'packages/markdown-core', 'web-platform/packages/markdown-core')) {
        $property = if ($lockPackages -is [Collections.IDictionary]) { $lockPackages[$key] } else { $lockPackages.PSObject.Properties[$key].Value }
        if (-not $property -or [string](Get-JsonMapValue -Object $property -Name 'version') -ne $expectedPackageVersion) {
            throw "package-lock.jsonの版が一致していません: packages[$key]"
        }
    }

    Assert-FileExists -Path $webGeneratedPath
    $generated = Get-Content -LiteralPath $webGeneratedPath -Raw
    if (-not $generated.Contains($expectedPackageVersion)) {
        throw 'web-platform/apps/web/src/targetVersions.generated.tsがtargets.jsonと一致していません。'
    }

    $historyPath = Join-Path $projectRootFullPath "dev\history\v$($publicMatch.Groups[1].Value)"
    if (-not (Test-Path -LiteralPath $historyPath -PathType Container)) {
        throw "対象履歴フォルダーがありません: $historyPath"
    }
}

function Get-TextFilesForResidueScan {
    $scanPaths = @(
        'package.json',
        'package-lock.json',
        'scripts',
        'src',
        'src-tauri/Cargo.toml',
        'src-tauri/Cargo.lock',
        'src-tauri/src',
        'packaging',
        'web-platform/targets.json',
        'web-platform/package.json',
        'web-platform/package-lock.json',
        'web-platform/scripts',
        'web-platform/packages',
        'web-platform/apps/web/src',
        'web-platform/apps/spfx/config',
        'web-platform/apps/spfx/src',
        'web-platform/apps/spfx/package.json',
        'web-platform/apps/spfx/package-lock.json'
    )
    $excludedRelativePaths = @(
        'web-platform/scripts/test-target-versions.mjs',
        'scripts/test-validation-runner.ps1',
        'scripts/test-version-update.ps1'
    )
    $extensions = @('.json', '.toml', '.rs', '.ts', '.tsx', '.js', '.mjs', '.ps1', '.md', '.html', '.xml', '.yaml', '.yml', '.lock')
    foreach ($relativeRoot in $scanPaths) {
        $rootPath = Join-Path $projectRootFullPath $relativeRoot
        if (-not (Test-Path -LiteralPath $rootPath)) { continue }
        $items = if (Test-Path -LiteralPath $rootPath -PathType Container) {
            Get-ChildItem -LiteralPath $rootPath -File -Recurse -Force
        }
        else {
            @(Get-Item -LiteralPath $rootPath)
        }
        foreach ($file in $items) {
            $relative = [IO.Path]::GetRelativePath($projectRootFullPath, $file.FullName).Replace('\', '/')
            $extensionAllowed = $extensions -contains $file.Extension.ToLowerInvariant()
            $pathAllowed = $excludedRelativePaths -notcontains $relative
            if ($extensionAllowed -and $pathAllowed) { $file }
        }
    }
}

function Find-OldVersionResidues {
    param(
        [Parameter(Mandatory)][string[]]$OldVersions,
        [Parameter(Mandatory)][string[]]$AllowedRelativePaths
    )
    $residues = [Collections.Generic.List[object]]::new()
    foreach ($file in Get-TextFilesForResidueScan) {
        $relative = [IO.Path]::GetRelativePath($projectRootFullPath, $file.FullName).Replace('\', '/')
        if ($AllowedRelativePaths -contains $relative) { continue }
        $content = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction Stop
        if ($null -eq $content) { $content = '' }
        foreach ($oldVersion in $OldVersions | Select-Object -Unique) {
            if (-not $content.Contains($oldVersion)) { continue }
            $lineNumber = 0
            foreach ($line in ($content -split "`r?`n")) {
                $lineNumber++
                if ($line.Contains($oldVersion)) {
                    $residues.Add([pscustomobject]@{ Path = $relative; Line = $lineNumber; Version = $oldVersion; Text = $line.Trim() })
                }
            }
        }
    }
    return $residues
}

function Invoke-NodeScript {
    param(
        [Parameter(Mandatory)][string]$ScriptPath,
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Arguments,
        [Parameter(Mandatory)][string]$LogPath
    )
    Import-Module (Join-Path $PSScriptRoot 'NodeRuntime.psm1') -Force
    $runtime = Get-MdVisualizerNodeRuntime -ProjectRoot $projectRootFullPath
    $utf8 = [Text.UTF8Encoding]::new($false)
    $previousConsoleOutputEncoding = [Console]::OutputEncoding
    $previousPowerShellOutputEncoding = $OutputEncoding
    try {
        New-Item -ItemType Directory -Path (Split-Path -Parent $LogPath) -Force -WhatIf:$false | Out-Null
        [IO.File]::AppendAllText($LogPath, "`n--- $([DateTime]::Now.ToString('s')) $([IO.Path]::GetFileName($ScriptPath)) $($Arguments -join ' ') ---`n", $utf8)
        [Console]::OutputEncoding = $utf8
        $OutputEncoding = $utf8
        & $runtime.NodeExecutable $ScriptPath @Arguments *>&1 | Out-File -LiteralPath $LogPath -Append -Encoding utf8 -WhatIf:$false
        if ($LASTEXITCODE -ne 0) {
            throw "Nodeスクリプトが終了コード $LASTEXITCODE で失敗しました。ログ: $LogPath"
        }
    }
    finally {
        [Console]::OutputEncoding = $previousConsoleOutputEncoding
        $OutputEncoding = $previousPowerShellOutputEncoding
    }
}

function Restore-FileBackups {
    param([Parameter(Mandatory)][hashtable]$Backups)
    foreach ($entry in $Backups.GetEnumerator()) {
        [IO.File]::WriteAllBytes($entry.Key, $entry.Value)
    }
}

function Update-VersionFiles {
    param(
        [Parameter(Mandatory)]$Snapshot,
        [Parameter(Mandatory)]$Plan,
        [Parameter(Mandatory)][string]$LogPath
    )

    $filesToSnapshot = @(
        $releaseConfigPath, $packageJsonPath, $packageLockPath, $tauriConfigPath,
        $cargoTomlPath, $cargoLockPath, $webTargetsPath, $webGeneratedPath,
        $webSpfxPackagePath, $webSpfxLockPath, $webSolutionPath, $webPackagePath,
        $webPackageLockPath, $webMarkdownCorePackagePath
    ) + $siteFiles
    $backups = @{}
    foreach ($file in $filesToSnapshot) {
        Assert-FileExists -Path $file
        $backups[$file] = [IO.File]::ReadAllBytes($file)
    }

    try {
        $release = $Snapshot.ReleaseConfig
        $release.application.publicVersion = $Plan.PublicVersion
        $release.application.packageVersion = $Plan.PackageVersion
        $release.application.msixVersion = $Plan.MsixVersion
        Write-TextFile -Path $releaseConfigPath -Content (ConvertTo-JsonText -Value $release)

        $package = $Snapshot.Package
        $package.version = $Plan.PackageVersion
        Write-TextFile -Path $packageJsonPath -Content (ConvertTo-JsonText -Value $package)

        $packageLock = $Snapshot.PackageLock
        $packageLock['version'] = $Plan.PackageVersion
        $lockPackages = Get-JsonMapValue -Object $packageLock -Name 'packages'
        foreach ($key in @('', 'packages/markdown-core', 'web-platform/packages/markdown-core')) {
            (Get-JsonMapValue -Object $lockPackages -Name $key)['version'] = $Plan.PackageVersion
        }
        Write-TextFile -Path $packageLockPath -Content (ConvertTo-JsonText -Value $packageLock)

        $tauri = $Snapshot.Tauri
        $tauri.version = $Plan.PackageVersion
        Write-TextFile -Path $tauriConfigPath -Content (ConvertTo-JsonText -Value $tauri)

        $cargo = Get-Content -LiteralPath $cargoTomlPath -Raw
        $cargo = [regex]::Replace($cargo, '(?ms)(^\[package\]\s*\r?\nname = "mdvisualizer"\s*\r?\nversion = ")[^"]+("\s*$)', "`${1}$($Plan.PackageVersion)`${2}", 1)
        Write-TextFile -Path $cargoTomlPath -Content $cargo

        $cargoLock = Get-Content -LiteralPath $cargoLockPath -Raw
        $cargoLock = [regex]::Replace($cargoLock, '(?ms)(^\[\[package\]\]\s*\r?\nname = "mdvisualizer"\s*\r?\nversion = ")[^"]+("\s*$)', "`${1}$($Plan.PackageVersion)`${2}", 1)
        Write-TextFile -Path $cargoLockPath -Content $cargoLock

        $targets = $Snapshot.Targets
        $targets.sharedVersion = $Plan.PackageVersion
        $targets.targets.html.version = $Plan.PackageVersion
        $targets.targets.php.version = $Plan.PackageVersion
        $targets.targets.spfx.version = $Plan.PackageVersion
        $targets.targets.spfx.solutionVersion = $Plan.MsixVersion
        Write-TextFile -Path $webTargetsPath -Content (ConvertTo-JsonText -Value $targets)
        Invoke-NodeScript -ScriptPath (Join-Path $webRoot 'scripts\generate-targets.mjs') -Arguments @() -LogPath $LogPath

        foreach ($file in $siteFiles) {
            $site = Get-Content -LiteralPath $file -Raw
            if (-not $site.Contains($Snapshot.MsixVersion)) {
                throw "配布ページに現在のMSIX版がありません。手動確認が必要です: $file"
            }
            Write-TextFile -Path $file -Content $site.Replace($Snapshot.MsixVersion, $Plan.MsixVersion)
        }

        return ,$backups
    }
    catch {
        foreach ($entry in $backups.GetEnumerator()) {
            [IO.File]::WriteAllBytes($entry.Key, $entry.Value)
        }
        throw
    }
}

Write-Host 'MdVisualizer beta版更新'
$snapshot = Get-VersionSnapshot
Assert-VersionSnapshot -Snapshot $snapshot
$currentHistoryVersion = "v$(($snapshot.PackageVersion -split '[+-]', 2)[0])"
$logRoot = if ($WhatIfPreference) {
    Join-Path ([IO.Path]::GetTempPath()) 'MdVisualizer-version-update-logs'
}
else {
    Join-Path $projectRootFullPath "dev\history\$currentHistoryVersion\logs\version-update"
}
$logPath = Join-Path $logRoot "version-update-$((Get-Date).ToString('yyyyMMdd-HHmmss'))-$PID.log"
Write-Host "Node.js実行ログ: $logPath"
Invoke-NodeScript -ScriptPath (Join-Path $webRoot 'scripts\generate-targets.mjs') -Arguments @('--check') -LogPath $logPath
Write-Host "現在の公開表示版: $($snapshot.PublicVersion)"
Write-Host "現在のアプリケーション版: $($snapshot.PackageVersion)"
Write-Host "現在のMSIX版: $($snapshot.MsixVersion)"
Write-Host "現在の履歴版: v$(($snapshot.PackageVersion -split '[+-]', 2)[0])"

if ([string]::IsNullOrWhiteSpace($TargetVersion)) {
    Write-Host ''
    Write-Host '入力凡例:'
    Write-Host '  入力形式: vメジャー.マイナー.パッチ.リビジョン または メジャー.マイナー.パッチ.リビジョン'
    Write-Host '  入力例:   v1.2.3.4 または 1.2.3.4'
    Write-Host '  4つ目の番号はbeta版のリビジョンとして使用します。'
    $TargetVersion = Read-Host '変更後のバージョンを入力してください'
}

$plan = New-VersionPlan -Target $TargetVersion -CurrentMsixVersion $snapshot.MsixVersion
Write-Host ''
Write-Host '変換後の更新内容:'
Write-Host "  公開表示版:       $($plan.PublicVersion)"
Write-Host "  アプリケーション版: $($plan.PackageVersion)"
Write-Host "  MSIX版:            $($plan.MsixVersion)"
Write-Host "  検証履歴版:        $($plan.HistoryVersion)"

if ($WhatIfPreference) {
    Write-Host 'WhatIf: ファイルは変更していません。'
    exit 0
}

if (-not $Yes) {
    Write-Host ''
    Write-Host '確認凡例:'
    Write-Host '  Y または Yes: 上記の版へ更新します。'
    Write-Host '  N または No:  更新せず終了します。'
    $confirmation = Read-Host 'この内容で更新しますか'
    if ($confirmation -notmatch '^(?i:y|yes)$') {
        Write-Host '更新を中止しました。'
        exit 0
    }
}

if (-not $PSCmdlet.ShouldProcess($projectRootFullPath, "MdVisualizerを$($plan.MsixVersion)へ更新")) {
    exit 0
}

$oldVersions = @($snapshot.PublicVersion, $snapshot.PackageVersion, $snapshot.MsixVersion)
$backups = Update-VersionFiles -Snapshot $snapshot -Plan $plan -LogPath $logPath
try {
    $updatedSnapshot = Get-VersionSnapshot
    Assert-VersionSnapshot -Snapshot $updatedSnapshot
    $residues = @(Find-OldVersionResidues -OldVersions $oldVersions -AllowedRelativePaths @(
            'dev/history',
            'dev/research',
            'web-platform/scripts/test-target-versions.mjs',
            'scripts/test-validation-runner.ps1',
            'scripts/test-version-update.ps1'
        ))
    if ($residues.Count -gt 0) {
        $details = ($residues | ForEach-Object { "  $($_.Path):$($_.Line) [$($_.Version)] $($_.Text)" }) -join "`n"
        throw "旧版表記の残骸を検出しました。更新結果を確認してください。`n$details"
    }

    Invoke-NodeScript -ScriptPath (Join-Path $webRoot 'scripts\generate-targets.mjs') -Arguments @('--check') -LogPath $logPath
}
catch {
    Restore-FileBackups -Backups $backups
    throw
}
Write-Host '旧版残骸検査: 0件（履歴資料・研究資料・テストfixtureは対象外）'
Write-Host ''
Write-Host 'バージョン更新と旧版残骸検査が完了しました。'
Write-Host "更新版: $($plan.PublicVersion)"
