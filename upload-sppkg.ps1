#Requires -Version 7.0

[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$SkipBuild,
    [switch]$SkipDeploy,
    [string]$AppCatalogUrl = 'https://excelchunchun.sharepoint.com/sites/test-team-site',
    [ValidateSet('sitecollection', 'tenant')]
    [string]$AppCatalogScope = 'sitecollection'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$packagePath = Join-Path $PSScriptRoot 'spfx\sharepoint\solution\spfx-mdvisualizer.sppkg'
$nodeRoot = Join-Path $PSScriptRoot '.tools\node-v22.23.2-win-x64'
$nodeExe = Join-Path $nodeRoot 'node.exe'
$npmCli = Join-Path $nodeRoot 'node_modules\npm\bin\npm-cli.js'
$spfxRoot = Join-Path $PSScriptRoot 'spfx'

if (!$SkipBuild) {
    & (Join-Path $PSScriptRoot 'scripts\build-release-MdVisualizer-spfx.ps1')
    if ($LASTEXITCODE -ne 0) { throw "SPFx buildが終了コード $LASTEXITCODE で失敗しました。" }
}
if (!(Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    throw "アップロードするsppkgがありません: $packagePath"
}
if (!(Test-Path -LiteralPath $nodeExe -PathType Leaf) -or !(Test-Path -LiteralPath $npmCli -PathType Leaf)) {
    throw '固定Node.js環境がありません。先にscripts/build-release-MdVisualizer-spfx.ps1を実行してください。'
}

$arguments = @(
    'exec', '--', 'm365', 'spo', 'app', 'add',
    '--filePath', $packagePath,
    '--appCatalogScope', $AppCatalogScope,
    '--appCatalogUrl', $AppCatalogUrl,
    '--overwrite',
    '--output', 'json'
)

if (!$PSCmdlet.ShouldProcess("$AppCatalogUrl ($AppCatalogScope)", "$(Split-Path -Leaf $packagePath) を上書きアップロード")) {
    return
}

Push-Location $spfxRoot
try {
    & $nodeExe $npmCli @arguments
    if ($LASTEXITCODE -ne 0) {
        throw 'App Catalogへのアップロードに失敗しました。m365 loginをSharePoint委任AllSites.FullControlへ管理者同意済みのアプリで再認証したか確認してください。'
    }
    if (-not $SkipDeploy) {
        & $nodeExe $npmCli exec -- m365 spo app deploy `
            --name (Split-Path -Leaf $packagePath) `
            --appCatalogScope $AppCatalogScope `
            --appCatalogUrl $AppCatalogUrl `
            --skipFeatureDeployment `
            --output json
        if ($LASTEXITCODE -ne 0) { throw 'App Catalogでの全サイト自動展開に失敗しました。' }
    }
    else {
        Write-Host 'App Catalogへのアップロードのみ完了しました。全サイト自動展開は実行していません。'
    }
}
finally {
    Pop-Location
}
