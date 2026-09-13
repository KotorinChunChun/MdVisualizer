#Requires -Version 7.0
[CmdletBinding()]
param([switch]$ReleaseIntentConfirmed)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (!$ReleaseIntentConfirmed) { throw 'ポータブル版生成には-ReleaseIntentConfirmedが必要です。' }
$projectRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1') -Force
$configuration = Import-ReleaseConfiguration -ProjectRoot $projectRoot
$version = Get-ConfiguredApplicationVersion -Configuration $configuration
$artifactVersion = Get-ConfiguredMsixVersion -Configuration $configuration
$executable = Join-Path $projectRoot 'src-tauri/target/release/mdvisualizer.exe'
if (!(Test-Path -LiteralPath $executable -PathType Leaf)) { throw '先にproduction版をビルドしてください。' }
$actualVersion = (Get-Item -LiteralPath $executable).VersionInfo.ProductVersion
if (($actualVersion -split '-')[0] -ne $version) { throw "実行ファイルの版が一致しません: $actualVersion / $version" }
$output = Join-Path $projectRoot "release/MdVisualizer_${artifactVersion}_x64_portable.zip"
New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
# ファイル一覧を固定し、ユーザー設定、文書、秘密情報を収集しない。
Compress-Archive -LiteralPath $executable -DestinationPath $output -Force
$archive = [IO.Compression.ZipFile]::OpenRead($output)
try {
    if ($archive.Entries.Count -ne 1 -or $archive.Entries[0].FullName -ne 'mdvisualizer.exe') { throw 'ZIP内容が許可リストと一致しません。' }
    $stream = $archive.Entries[0].Open()
    try { $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) } finally { $stream.Dispose() }
    if ($hash -ne (Get-FileHash $executable -Algorithm SHA256).Hash) { throw 'ZIP内実行ファイルのハッシュが一致しません。' }
} finally { $archive.Dispose() }
Get-Item $output | Select-Object FullName, Length
Get-FileHash $output -Algorithm SHA256
