#Requires -Version 7.4
# 証明書ストア・実アプリ・releaseを変更しない。署名検証はメモリ内だけで行う。
[CmdletBinding()]
param([string]$ExistingThumbprint, [string]$ExistingPublisher)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'MsixSigning.psm1') -Force
$script:checks = 0
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "検証失敗: $Message" }
    $script:checks++
}
function Assert-Rejected([scriptblock]$Action, [string]$Expected) {
    $message = ''
    try { & $Action | Out-Null } catch { $message = $_.Exception.Message }
    Assert-True ($message.Contains($Expected)) "拒否理由: $Expected / 実際: $message"
}
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
$fixture = Join-Path $tempRoot ('msix-signing-tests-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixture) | Out-Null
$profilePath = Join-Path $fixture 'signing.json'
$rsa = [Security.Cryptography.RSA]::Create(2048)
$cert = $null; $public = $null; $noEku = $null; $badUsage = $null
try {
    foreach ($name in @('MsixSigning.psm1', 'initialize-msix-signing.ps1', 'build-msix.ps1', 'publish-MarkdownViewer.ps1', 'test-msix-signing.ps1')) {
        $tokens = $null; $errors = $null
        [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name), [ref]$tokens, [ref]$errors) | Out-Null
        Assert-True ($errors.Count -eq 0) "PowerShell構文: $name"
    }
    $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=MSIX Test', $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $oids = [Security.Cryptography.OidCollection]::new()
    $oids.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3')) | Out-Null
    $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $false))
    $cert = $request.CreateSelfSigned([DateTimeOffset]::Now.AddDays(-1), [DateTimeOffset]::Now.AddDays(30))
    Assert-MsixSigningCertificate $cert 'CN=MSIX Test' $cert.Thumbprint
    $script:checks++
    Assert-Rejected { Assert-MsixSigningCertificate $cert 'CN=Other' $cert.Thumbprint } '一致しません'
    Assert-Rejected { Assert-MsixSigningCertificate $cert 'CN=MSIX Test' ('0' * 40) } '一致しません'
    Assert-Rejected { Assert-MsixSigningCertificate $cert 'CN=MSIX Test' $cert.Thumbprint -Now (Get-Date).AddDays(-3) } '有効期間外'
    Assert-Rejected { Assert-MsixSigningCertificate $cert 'CN=MSIX Test' $cert.Thumbprint -Now (Get-Date).AddDays(24) } '期限まで7日以下'
    Assert-Rejected { Assert-MsixSigningCertificate $cert 'CN=MSIX Test' $cert.Thumbprint -Now (Get-Date).AddDays(31) } '有効期間外'
    $public = [Security.Cryptography.X509Certificates.X509Certificate2]::new($cert.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))
    Assert-Rejected { Assert-MsixSigningCertificate $public 'CN=MSIX Test' $public.Thumbprint } '秘密鍵がありません'
    $emptyRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=MSIX Test', $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $noEku = $emptyRequest.CreateSelfSigned([DateTimeOffset]::Now.AddDays(-1), [DateTimeOffset]::Now.AddDays(30))
    Assert-Rejected { Assert-MsixSigningCertificate $noEku 'CN=MSIX Test' $noEku.Thumbprint } 'Code Signing'
    $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment, $true))
    $badUsage = $request.CreateSelfSigned([DateTimeOffset]::Now.AddDays(-1), [DateTimeOffset]::Now.AddDays(30))
    Assert-Rejected { Assert-MsixSigningCertificate $badUsage 'CN=MSIX Test' $badUsage.Thumbprint } 'デジタル署名'
    Assert-Rejected { Read-MsixSigningProfile $profilePath } '署名設定がありません'
    $profile = [ordered]@{schemaVersion=1;storeLocation='CurrentUser';storeName='My';thumbprint=('0' * 40);publisher='CN=MSIX Test'}
    function Write-Profile { $profile | ConvertTo-Json | Set-Content -LiteralPath $profilePath -Encoding utf8NoBOM }
    Write-Profile
    Assert-True ((Read-MsixSigningProfile $profilePath).publisher -ceq 'CN=MSIX Test') '設定の正常読込'
    Assert-Rejected { Get-MsixSigningCertificate 'CN=Other' -ProfilePath $profilePath } 'Publisher'
    Assert-Rejected { Get-MsixSigningCertificate 'CN=MSIX Test' -ProfilePath $profilePath -CertificateThumbprint ('1' * 40) } '上書き指定'
    Assert-Rejected { Get-MsixSigningCertificate 'CN=MSIX Test' -ProfilePath $profilePath } '証明書がCurrentUser/Myにありません'
    foreach ($pair in @(@('schemaVersion', 2), @('storeLocation', 'LocalMachine'), @('storeName', '../Root'), @('thumbprint', '../*'), @('publisher', 'bad'))) {
        $old = $profile[$pair[0]]; $profile[$pair[0]] = $pair[1]; Write-Profile
        Assert-Rejected { Read-MsixSigningProfile $profilePath } '不正'
        $profile[$pair[0]] = $old
    }
    $profile['password'] = 'fixture-not-a-secret'; Write-Profile
    Assert-Rejected { Read-MsixSigningProfile $profilePath } '追加項目'
    $profile.Remove('password'); $profile.Remove('publisher'); Write-Profile
    Assert-Rejected { Read-MsixSigningProfile $profilePath } '項目が不正'
    Set-Content -LiteralPath $profilePath -Value '{ malformed' -Encoding utf8NoBOM
    Assert-Rejected { Read-MsixSigningProfile $profilePath } 'JSONとして読み込めません'
    foreach ($invalid in @('null', '[]', '[1,2]', '"text"')) {
        Set-Content -LiteralPath $profilePath -Value $invalid -Encoding utf8NoBOM
        Assert-Rejected { Read-MsixSigningProfile $profilePath } '項目が不正'
    }
    if ($ExistingThumbprint) {
        if (-not $ExistingPublisher) { throw 'ExistingPublisherを指定してください。' }
        $initializer = Join-Path $PSScriptRoot 'initialize-msix-signing.ps1'
        $livePath = Join-Path $fixture 'live.json'
        & $initializer -CertificateThumbprint $ExistingThumbprint -Publisher $ExistingPublisher -ProfilePath $livePath -WhatIf
        Assert-True (-not (Test-Path -LiteralPath $livePath)) 'WhatIfで設定を作らない'
        & $initializer -CertificateThumbprint $ExistingThumbprint -Publisher $ExistingPublisher -ProfilePath $livePath
        $stamp = [IO.File]::GetLastWriteTimeUtc($livePath)
        & $initializer -CertificateThumbprint $ExistingThumbprint -Publisher $ExistingPublisher -ProfilePath $livePath
        Assert-True ([IO.File]::GetLastWriteTimeUtc($livePath) -eq $stamp) '再実行で設定を変更しない'
        $liveCert = Get-MsixSigningCertificate $ExistingPublisher -ProfilePath $livePath
        $privateRsa = $null; $publicRsa = $null
        try {
            Assert-True ($liveCert.Thumbprint -eq $ExistingThumbprint) '既存証明書の再利用'
            $privateRsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($liveCert)
            $publicRsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($liveCert)
            $challenge = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
            $signature = $privateRsa.SignData($challenge, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
            Assert-True ($publicRsa.VerifyData($challenge, $signature, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)) '秘密鍵を輸出せず署名と公開鍵検証'
        } finally {
            if ($privateRsa) { $privateRsa.Dispose() }; if ($publicRsa) { $publicRsa.Dispose() }; $liveCert.Dispose()
        }
        $conflicting = Get-Content -LiteralPath $livePath -Raw | ConvertFrom-Json
        $conflicting.thumbprint = '0' * 40
        $conflicting | ConvertTo-Json | Set-Content -LiteralPath $livePath -Encoding utf8NoBOM
        $hash = (Get-FileHash -LiteralPath $livePath).Hash
        Assert-Rejected { & $initializer -CertificateThumbprint $ExistingThumbprint -Publisher $ExistingPublisher -ProfilePath $livePath } '上書きせず'
        Assert-True ((Get-FileHash -LiteralPath $livePath).Hash -eq $hash) '競合設定を維持する'
    }
    Write-Output "共通MSIX署名検証: $script:checks 件成功（ストア変更・PFX出力・アプリ署名なし）"
} finally {
    foreach ($item in @($cert, $public, $noEku, $badUsage, $rsa)) { if ($item) { $item.Dispose() } }
    $resolved = [IO.Path]::GetFullPath($fixture)
    if (-not $resolved.StartsWith($tempRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -notlike 'msix-signing-tests-*') { throw '一時検証フォルダーの削除範囲が不正です。' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
