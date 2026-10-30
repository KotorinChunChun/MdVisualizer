#Requires -Version 7.4
[CmdletBinding(SupportsShouldProcess)]
param([switch]$ReleaseIntentConfirmed, [switch]$PublishConfirmed)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (!$ReleaseIntentConfirmed -or !$PublishConfirmed) { throw '公開にはリリースとGitHub公開の明示確認が必要です。' }
$root = Split-Path -Parent $PSScriptRoot
$repo = 'KotorinChunChun/MdVisualizer'
$config = Get-Content (Join-Path $root 'packaging/release-config.json') -Raw | ConvertFrom-Json
$version = $config.application.msixVersion
if ($version -cnotmatch '^\d+\.\d+\.\d+\.\d+$') { throw 'MSIX版が不正です。' }
function GitChecked([string[]]$Arguments) {
    $result = & git -c "safe.directory=$root" -C $root @Arguments
    if ($LASTEXITCODE) { throw 'Git検査に失敗しました。' }
    $result
}
function GhChecked([string[]]$Arguments) {
    $result = & gh @Arguments
    if ($LASTEXITCODE) { throw 'GitHub操作に失敗しました。既存Releaseは上書きしません。' }
    $result
}
if (@(GitChecked @('status','--porcelain')).Count) { throw '公開元の未コミット差分を解決してください。' }
$commit = GitChecked @('rev-parse','HEAD')
$remote = GitChecked @('ls-remote','origin','refs/heads/main')
if (($remote -split '\s+')[0] -cne $commit) { throw '公開mainと採用コミットが一致しません。' }
$metadata = GhChecked @('api',"repos/$repo") | ConvertFrom-Json
if ($metadata.private -or $metadata.full_name -cne $repo) { throw '指定した公開リポジトリが必要です。' }
$existing = GhChecked @('api',"repos/$repo/releases?per_page=100") | ConvertFrom-Json
if (@($existing | Where-Object tag_name -eq "v$version").Count) { throw '同版Releaseは既に存在します。' }
if (GitChecked @('ls-remote','origin',"refs/tags/v$version")) { throw '同版タグは既に存在します。' }
$msix = Join-Path $root "release/msix/MdVisualizer_${version}_x64.msix"
$zip = Join-Path $root "release/MdVisualizer_${version}_x64_portable.zip"
$cer = Join-Path $root 'release/msix/MdVisualizer.cer'
foreach ($file in @($msix,$zip,$cer)) { if (!(Test-Path $file -PathType Leaf)) { throw '必要な配布物がありません。' } }
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($cer)
try {
    if ($certificate.HasPrivateKey -or $certificate.Subject -cne 'CN=KotorinChunChun' -or
        $certificate.Thumbprint -cne '475BABC3C3D1E871D90503D45CC5236216D85EE8') { throw '公開証明書が固定値と一致しません。' }
} finally { $certificate.Dispose() }
$sdk = Get-ChildItem 'C:/Program Files (x86)/Windows Kits/10/bin' -Directory | Where-Object Name -Match '^10\.' |
    Sort-Object { [version]$_.Name } -Descending | ForEach-Object { Join-Path $_.FullName 'x64/signtool.exe' } |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (!$sdk) { throw 'signtoolがありません。' }
& $sdk verify /pa /v $msix
if ($LASTEXITCODE) { throw '実MSIXの署名を検証できません。' }
$archive = [IO.Compression.ZipFile]::OpenRead($msix)
try {
    $entry = $archive.GetEntry('AppxManifest.xml')
    $reader = [IO.StreamReader]::new($entry.Open())
    try { [xml]$manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
    if ($manifest.Package.Identity.Name -cne 'com.mdvisualizer.viewer' -or $manifest.Package.Identity.Version -cne $version -or
        $manifest.Package.Identity.Publisher -cne 'CN=KotorinChunChun' -or
        $manifest.Package.Applications.Application.Executable -cne 'mdvisualizer.exe' -or
        $manifest.Package.Applications.Application.Id -cne 'MdVisualizer') { throw '実MSIXの固定Identityが一致しません。' }
} finally { $archive.Dispose() }
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
    if ($archive.Entries.Count -ne 1 -or $archive.Entries[0].FullName -cne 'mdvisualizer.exe') { throw 'ZIP内容が許可リストと一致しません。' }
    $stream = $archive.Entries[0].Open()
    try { $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) } finally { $stream.Dispose() }
    if ($hash -cne (Get-FileHash (Join-Path $root 'src-tauri/target/release/mdvisualizer.exe')).Hash) { throw 'ZIPと採用EXEが一致しません。' }
} finally { $archive.Dispose() }
$sums = Join-Path $root 'release/SHA256SUMS.txt'
@($msix,$zip,$cer) | ForEach-Object { "$((Get-FileHash $_ -Algorithm SHA256).Hash.ToLowerInvariant())  $(Split-Path $_ -Leaf)" } |
    Set-Content $sums -Encoding utf8NoBOM
$notes = Join-Path $root 'release/github-notes.md'
@"
Windows x64用の開発版です。KotorinToys 0.1.16以降のコレクションから署名済みMSIXを導入・起動・表示・終了できます。常駐・自動起動は行いません。

MSIXの固定Identityはcom.mdvisualizer.viewer、PublisherはCN=KotorinChunChunです。初回の証明書の信頼登録は利用者が配布元・拇印を確認して行います。証明書を自動登録しません。ZIPは単独EXEのポータブル版です。SHA256SUMS.txtで取得物を確認できます。

HTTPSからWikiライブラリ・フォルダー内のMarkdownを選んで開けるようにしました。直前の受信URLの原文・日時・経路・エラーの確認と明示コピー、ボタンのショートカットツールチップ、Ctrl+O、設定Ctrl+S、赤背景エラーの白文字表示に対応します。受信URLはメモリー内だけに保持します。

実SharePointテナントでの認証・権限・文書取得、実MSIXの導入・更新は今回の受入では未確認です。実画面確認と自動テストの範囲は版別報告を参照してください。

管理契約2と未保存文書の終了保護に対応します。採用コミット: $commit
"@ | Set-Content $notes -Encoding utf8NoBOM
if ($PSCmdlet.ShouldProcess("$repo v$version", '検証済みWindows成果物を新規prereleaseとして公開')) {
    GhChecked @('release','create',"v$version",$msix,$zip,$cer,$sums,'--repo',$repo,'--target',$commit,
        '--title',"MdVisualizer $version 開発版",'--notes-file',$notes,'--prerelease')
}
