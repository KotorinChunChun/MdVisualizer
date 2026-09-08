[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$TestFile = (Join-Path $PSScriptRoot "..\samples\sample.md")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$resolvedTestFile = (Resolve-Path -LiteralPath $TestFile -ErrorAction Stop).Path
$launcher = Join-Path $PSScriptRoot "run-debug-MarkdownViewer-all.ps1"

if (-not $PSCmdlet.ShouldProcess($resolvedTestFile, "サンプル文書を使用してMarkdownViewerをデバッグ起動")) {
    return
}

& $launcher -DocumentPath @($resolvedTestFile) -Confirm:$false
if ($LASTEXITCODE -ne 0) {
    throw "MarkdownViewerのサンプルデバッグ起動が終了コード $LASTEXITCODE で失敗しました。"
}
