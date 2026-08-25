[CmdletBinding(SupportsShouldProcess)]
param(
    [string[]]$DocumentPath = @(),
    [switch]$Wait
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedDocuments = @($DocumentPath | ForEach-Object {
    (Resolve-Path -LiteralPath $_ -ErrorAction Stop).Path
})

if (-not $PSCmdlet.ShouldProcess("MarkdownViewer 全機能", "リリースビルドして起動")) {
    return
}

Push-Location $projectRoot
try {
    & npm.cmd run tauri -- build --no-bundle
    if ($LASTEXITCODE -ne 0) {
        throw "MarkdownViewerのリリースビルドが終了コード $LASTEXITCODE で失敗しました。"
    }
} finally {
    Pop-Location
}

& (Join-Path $PSScriptRoot "run-exe-MarkdownViewer-all.ps1") `
    -Configuration release `
    -DocumentPath $resolvedDocuments `
    -Wait:$Wait `
    -Confirm:$false
