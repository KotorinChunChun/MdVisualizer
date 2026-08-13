#Requires -Version 7.0

[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$SkipBuild,
    [switch]$Deploy,
    [string]$AppCatalogUrl = 'https://excelchunchun.sharepoint.com/sites/test-team-site',
    [ValidateSet('sitecollection', 'tenant')]
    [string]$AppCatalogScope = 'sitecollection'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$packagePath = Join-Path $PSScriptRoot 'spfx\sharepoint\solution\spfx-markdown-editor.sppkg'
$nodeRoot = Join-Path $PSScriptRoot '.tools\node-v22.23.2-win-x64'
$nodeExe = Join-Path $nodeRoot 'node.exe'
$npmCli = Join-Path $nodeRoot 'node_modules\npm\bin\npm-cli.js'
$spfxRoot = Join-Path $PSScriptRoot 'spfx'

if (!$SkipBuild) {
    & (Join-Path $PSScriptRoot 'build-spfx.ps1') -SkipUpload
    if ($LASTEXITCODE -ne 0) { throw "SPFx buildが終了コード $LASTEXITCODE で失敗しました。" }
}
if (!(Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    throw "アップロードするsppkgがありません: $packagePath"
}
if (!(Test-Path -LiteralPath $nodeExe -PathType Leaf) -or !(Test-Path -LiteralPath $npmCli -PathType Leaf)) {
    throw '固定Node.js環境がありません。先にbuild-spfx.ps1 -SkipUploadを実行してください。'
}

$arguments = @(
    'exec', '--', 'm365', 'spo', 'app', 'add',
    '--filePath', $packagePath,
    '--appCatalogScope', $AppCatalogScope,
    '--appCatalogUrl', $AppCatalogUrl,
    '--overwrite',
    '--output', 'none'
)

if (!$PSCmdlet.ShouldProcess("$AppCatalogUrl ($AppCatalogScope)", "$(Split-Path -Leaf $packagePath) を上書きアップロード")) {
    return
}

Push-Location $spfxRoot
try {
    & $nodeExe $npmCli @arguments
    if ($LASTEXITCODE -ne 0) {
        throw 'App Catalogへのアップロードに失敗しました。m365 loginの認証状態と権限を確認してください。'
    }
    if ($Deploy) {
        & $nodeExe $npmCli exec -- m365 spo app deploy `
            --name (Split-Path -Leaf $packagePath) `
            --appCatalogScope $AppCatalogScope `
            --appCatalogUrl $AppCatalogUrl `
            --output none
        if ($LASTEXITCODE -ne 0) { throw 'App Catalogでの有効化に失敗しました。' }
    }
}
finally {
    Pop-Location
}
