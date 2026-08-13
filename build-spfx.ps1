#Requires -Version 7.0

[CmdletBinding()]
param(
    [switch]$SkipUpload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'scripts\Invoke-Spfx.ps1') build
if ($LASTEXITCODE -ne 0) {
    throw "SPFx buildが終了コード $LASTEXITCODE で失敗しました。"
}

if (!$SkipUpload) {
    Write-Host 'sppkg生成成功後のApp Catalog上書き更新と全サイト自動展開を開始します。'
    & (Join-Path $PSScriptRoot 'upload-sppkg.ps1') -SkipBuild
    if ($LASTEXITCODE -ne 0) {
        throw "App Catalog更新が終了コード $LASTEXITCODE で失敗しました。"
    }
}
