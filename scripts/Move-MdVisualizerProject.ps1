#Requires -Version 7.0
[CmdletBinding(SupportsShouldProcess)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$destination = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $source) 'MdVisualizer'))
if ($source -eq $destination) {
    Write-Output '既にMdVisualizerフォルダーです。'
    return
}
if ((Split-Path -Leaf $source) -ne 'MarkdownViewer' -or !(Test-Path -LiteralPath (Join-Path $source '.git'))) {
    throw '旧名のGit作業フォルダーではないため移動しません。'
}
if (Test-Path -LiteralPath $destination) { throw '移動先が存在するため中止します。' }
$links = @('node_modules\@mdvisualizer\markdown-core', 'spfx\node_modules\@mdvisualizer\markdown-core')
$repair = @()
foreach ($relative in $links) {
    $link = Join-Path $source $relative
    if (!(Test-Path -LiteralPath $link)) { continue }
    $item = Get-Item -LiteralPath $link
    if ($item.LinkType -ne 'Junction' -or $item.Target -ne (Join-Path $source 'packages\markdown-core')) {
        throw "想定外の共有coreリンクです: $link"
    }
    $repair += $relative
}
if (!$PSCmdlet.ShouldProcess("$source → $destination", '作業フォルダー移動と共有coreリンクの付け替え')) { return }
# 自分自身の作業ディレクトリが移動を妨げないよう親へ移る。
Set-Location -LiteralPath (Split-Path -Parent $source)
try { Move-Item -LiteralPath $source -Destination $destination }
catch { throw "移動できません。Codex・エディター・ターミナルなどを閉じて再実行してください。$($_.Exception.Message)" }
foreach ($relative in $repair) {
    $link = Join-Path $destination $relative
    # Junction本体だけを外す。参照先フォルダーを再帰削除しない。
    Remove-Item -LiteralPath $link -Force
    New-Item -ItemType Junction -Path $link -Target (Join-Path $destination 'packages\markdown-core') | Out-Null
}
Write-Output "移動しました: $destination"
Write-Output 'Codexで新しいフォルダーを開き直してください。'
