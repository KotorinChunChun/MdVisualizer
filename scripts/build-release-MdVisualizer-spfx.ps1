#Requires -Version 7.0

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'Invoke-Spfx.ps1') build
if ($LASTEXITCODE -ne 0) {
    throw "SPFx buildが終了コード $LASTEXITCODE で失敗しました。"
}
