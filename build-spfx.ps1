#Requires -Version 7.0

[CmdletBinding()]
param([switch]$SkipUpload)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $SkipUpload) {
    Write-Warning 'build-spfx.ps1の暗黙アップロードは廃止されました。ローカルビルドを実行します。公開はscripts/publish-release-MarkdownViewer-spfx.ps1を明示的に使用してください。'
}

& (Join-Path $PSScriptRoot 'scripts\build-release-MarkdownViewer-spfx.ps1')
if ($LASTEXITCODE -ne 0) {
    throw "SPFx buildが終了コード $LASTEXITCODE で失敗しました。"
}
