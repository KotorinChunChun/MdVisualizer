#Requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('setup', 'build', 'test', 'start', 'audit', 'clean')]
    [string]$Action = 'build'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$NodeVersion = '22.23.2'
$NodeArchiveName = "node-v$NodeVersion-win-x64.zip"
$NodeArchiveSha256 = '1177B4137BA5ADAA56354AE40F1080C7450E8AE09CECB47DA459D1C52AC99F97'
$NodeDownloadUrl = "https://nodejs.org/dist/v$NodeVersion/$NodeArchiveName"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SpfxRoot = Join-Path $ProjectRoot 'spfx'
$CoreRoot = Join-Path $ProjectRoot 'packages\markdown-core'
$ToolsRoot = Join-Path $ProjectRoot '.tools'
$DownloadsRoot = Join-Path $ToolsRoot 'downloads'
$NodeRoot = Join-Path $ToolsRoot "node-v$NodeVersion-win-x64"
$NodeArchive = Join-Path $DownloadsRoot $NodeArchiveName
$NodeExe = Join-Path $NodeRoot 'node.exe'
$NpmCli = Join-Path $NodeRoot 'node_modules\npm\bin\npm-cli.js'

function Assert-ToolsChildPath {
    param([Parameter(Mandatory)][string]$Path)
    $root = [System.IO.Path]::GetFullPath($ToolsRoot).TrimEnd([char]'\')
    $target = [System.IO.Path]::GetFullPath($Path).TrimEnd([char]'\')
    if ($target -eq $root -or !$target.StartsWith("$root\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "プロジェクトの.tools配下ではないパスを操作しようとしました: $target"
    }
}

function Remove-ToolsItem {
    param([Parameter(Mandatory)][string]$Path)
    Assert-ToolsChildPath -Path $Path
    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Recurse -Force }
}

function Test-NodeRuntime {
    if (!(Test-Path -LiteralPath $NodeExe) -or !(Test-Path -LiteralPath $NpmCli)) { return $false }
    try { return (& $NodeExe --version) -eq "v$NodeVersion" } catch { return $false }
}

function Initialize-NodeRuntime {
    if (Test-NodeRuntime) { return }
    Remove-ToolsItem -Path $NodeRoot
    New-Item -ItemType Directory -Path $DownloadsRoot -Force | Out-Null
    if (!(Test-Path -LiteralPath $NodeArchive) -or (Get-FileHash -LiteralPath $NodeArchive -Algorithm SHA256).Hash -ne $NodeArchiveSha256) {
        if (Test-Path -LiteralPath $NodeArchive) { Remove-ToolsItem -Path $NodeArchive }
        $partial = "$NodeArchive.partial"
        Remove-ToolsItem -Path $partial
        Write-Host "Node.js v${NodeVersion}を公式サイトから取得します。"
        try {
            Invoke-WebRequest -Uri $NodeDownloadUrl -OutFile $partial
            $hash = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash
            if ($hash -ne $NodeArchiveSha256) { throw "Node.js ZIPのSHA-256が一致しません。実測: $hash" }
            Move-Item -LiteralPath $partial -Destination $NodeArchive
        }
        finally { if (Test-Path -LiteralPath $partial) { Remove-ToolsItem -Path $partial } }
    }
    $extractRoot = Join-Path $ToolsRoot "extract-node-$PID-$([guid]::NewGuid().ToString('N'))"
    Assert-ToolsChildPath -Path $extractRoot
    try {
        New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
        Expand-Archive -LiteralPath $NodeArchive -DestinationPath $extractRoot -Force
        Move-Item -LiteralPath (Join-Path $extractRoot "node-v$NodeVersion-win-x64") -Destination $NodeRoot
    }
    finally { Remove-ToolsItem -Path $extractRoot }
    if (!(Test-NodeRuntime)) { throw "Node.js v${NodeVersion}を初期化できませんでした。" }
}

function Invoke-ProjectNpm {
    param(
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string[]]$Arguments
    )
    Initialize-NodeRuntime
    $previousPath = $env:Path
    $env:Path = "$NodeRoot;$previousPath"
    Push-Location $WorkingDirectory
    try {
        & $NodeExe $NpmCli @Arguments
        if ($LASTEXITCODE -ne 0) { throw "npm $($Arguments -join ' ') が終了コード $LASTEXITCODE で失敗しました。" }
    }
    finally { Pop-Location; $env:Path = $previousPath }
}

function Initialize-ProjectDependencies {
    param(
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$StampName
    )
    $lockFile = Join-Path $WorkingDirectory 'package-lock.json'
    $packageFile = Join-Path $WorkingDirectory 'package.json'
    $installedLock = Join-Path $WorkingDirectory 'node_modules\.package-lock.json'
    $stampFile = Join-Path $ToolsRoot $StampName
    if (!(Test-Path -LiteralPath $lockFile)) {
        throw "package-lock.jsonがありません: $lockFile"
    }
    $expected = "node=$NodeVersion`npackage=$((Get-FileHash -LiteralPath $packageFile -Algorithm SHA256).Hash)`npackage-lock=$((Get-FileHash -LiteralPath $lockFile -Algorithm SHA256).Hash)"
    $current = if (Test-Path -LiteralPath $stampFile) { (Get-Content -LiteralPath $stampFile -Raw).Trim() } else { '' }
    if ((Test-Path -LiteralPath $installedLock) -and $current -eq $expected) {
        Write-Host "依存関係はpackage-lock.jsonと同期済みです: $WorkingDirectory"
        return
    }
    Invoke-ProjectNpm -WorkingDirectory $WorkingDirectory -Arguments @('ci', '--prefer-offline', '--no-audit', '--no-fund')
    Set-Content -LiteralPath $stampFile -Value $expected -Encoding utf8NoBOM
}

function Assert-SpfxVersion {
    $targets = Get-Content -LiteralPath (Join-Path $ProjectRoot 'web-platform/targets.json') -Raw | ConvertFrom-Json
    $spfx = (Get-Content -LiteralPath (Join-Path $SpfxRoot 'package.json') -Raw | ConvertFrom-Json).version
    $solution = (Get-Content -LiteralPath (Join-Path $SpfxRoot 'config/package-solution.json') -Raw | ConvertFrom-Json).solution.version
    if ($spfx -ne $targets.targets.spfx.version -or $solution -ne $targets.targets.spfx.solutionVersion) {
        throw "SPFxの版がtargets.jsonと一致しません。generate-targets.mjsを実行してください。"
    }
}

Write-Host "SPFx action: $Action / Node.js v$NodeVersion"
Initialize-NodeRuntime
Assert-SpfxVersion

if ($Action -in @('setup', 'build', 'test', 'start', 'clean')) {
    Initialize-ProjectDependencies -WorkingDirectory $ProjectRoot -StampName 'desktop-dependencies.sha256'
    Invoke-ProjectNpm -WorkingDirectory $CoreRoot -Arguments @('run', 'build')
    Initialize-ProjectDependencies -WorkingDirectory $SpfxRoot -StampName 'spfx-dependencies.sha256'
}

switch ($Action) {
    'setup' { Write-Host 'SPFx開発環境の準備が完了しました。' }
    'build' { Invoke-ProjectNpm -WorkingDirectory $SpfxRoot -Arguments @('run', 'build') }
    'test' { Invoke-ProjectNpm -WorkingDirectory $SpfxRoot -Arguments @('run', 'test') }
    'start' { Invoke-ProjectNpm -WorkingDirectory $SpfxRoot -Arguments @('run', 'start') }
    'audit' { Invoke-ProjectNpm -WorkingDirectory $SpfxRoot -Arguments @('audit', '--omit=dev') }
    'clean' { Invoke-ProjectNpm -WorkingDirectory $SpfxRoot -Arguments @('run', 'clean') }
}
