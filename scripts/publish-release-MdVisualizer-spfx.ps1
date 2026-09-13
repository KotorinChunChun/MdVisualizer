#Requires -Version 7.0

[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$PublishConfirmed,
    [switch]$Deploy,
    [string]$AppCatalogUrl = 'https://excelchunchun.sharepoint.com/sites/test-team-site',
    [ValidateSet('sitecollection', 'tenant')]
    [string]$AppCatalogScope = 'sitecollection'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $PublishConfirmed) {
    throw 'SPFx公開には、ユーザーの明示指示を確認して-PublishConfirmedを指定してください。'
}

& (Join-Path $PSScriptRoot 'build-release-MdVisualizer-spfx.ps1')
if ($LASTEXITCODE -ne 0) {
    throw "SPFx buildが終了コード $LASTEXITCODE で失敗しました。"
}

$uploadScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'upload-sppkg.ps1'
$uploadArguments = @{
    SkipBuild = $true
    AppCatalogUrl = $AppCatalogUrl
    AppCatalogScope = $AppCatalogScope
}
if (-not $Deploy) {
    $uploadArguments.SkipDeploy = $true
}
if ($WhatIfPreference) {
    $uploadArguments.WhatIf = $true
}

& $uploadScript @uploadArguments
if ($LASTEXITCODE -ne 0) {
    throw "SPFx公開が終了コード $LASTEXITCODE で失敗しました。"
}
