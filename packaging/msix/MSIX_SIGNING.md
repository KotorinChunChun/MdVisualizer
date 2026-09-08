# PC共通MSIX署名

このPCの現在のWindowsユーザーで開発するアプリは、Store外のMSIX署名に同じ証明書を使う。
秘密鍵を各リポジトリへ複製せず、Windowsの`Cert:\CurrentUser\My`を参照する。
別Windowsユーザーには秘密鍵を自動共有しない。Store提出用のIdentityとMicrosoftによる署名は別経路のまま維持する。

## 共通設定と現在の証明書

- 設定: `%LOCALAPPDATA%\KotorinChunChun\MSIX\signing.json`
- Publisher: `CN=KotorinChunChun`
- 拇印: `475BABC3C3D1E871D90503D45CC5236216D85EE8`
- 有効期限: 2031-08-10 14:00:09（日本時間）
- 鍵: RSA 3072 bit、WindowsのMicrosoft Software Key Storage Providerで保持
- 元のFriendly Name: `MarkdownViewer Self-Signed Code Signing`（識別には使用しない）

MarkdownViewerで使用中の証明書をそのまま採用する。鍵・証明書の再発行、秘密鍵の輸出、信頼ストアの変更は不要。
JSONにはschemaVersion、storeLocation、storeName、thumbprint、publisherだけを保存する。秘密鍵やパスワードは含めない。

```json
{
  "schemaVersion": 1,
  "storeLocation": "CurrentUser",
  "storeName": "My",
  "thumbprint": "475BABC3C3D1E871D90503D45CC5236216D85EE8",
  "publisher": "CN=KotorinChunChun"
}
```

## 新しいアプリへの導入

1. 共通テンプレート`C:\develop\default\dev\templates\MsixSigning.psm1`をプロジェクトの署名スクリプトと同じディレクトリへコピーする。版管理するコードは各repoに置き、署名設定は共通JSONだけを参照する。
2. Store外MSIXのManifest Publisherを`CN=KotorinChunChun`にする。Identity Nameはアプリごとに固有に保つ。
3. 既存のガード付きリリース処理で、ビルド前に下記の関数を呼び、署名時はその拇印をSignToolへ渡す。Friendly Name検索、`/a`による自動選択、個別PFX、証明書の自動発行へフォールバックしない。
4. 配布CERとMSIX署名者の拇印一致を検証する。公開してよいのはCERだけ。新アプリ用に秘密鍵を作らない。

```powershell
Import-Module (Join-Path $PSScriptRoot 'MsixSigning.psm1') -Force
$certificate = Get-MsixSigningCertificate -Publisher $manifestPublisher
try {
    # 既存の明示承認済みリリース処理内で使用する。
    & $signTool sign /fd SHA256 /s My /sha1 $certificate.Thumbprint $msixPath
    if ($LASTEXITCODE -ne 0) { throw 'MSIX署名に失敗しました。' }
} finally { $certificate.Dispose() }
```

共通JSONの初期登録は、同梱の`initialize-msix-signing.ps1`に既存の拇印とPublisherを渡す。
同じ設定への再実行は無変更。別証明書の設定があれば上書きを拒否する。`-WhatIf`で保存前に確認できる。
共通モジュールを更新した場合は、MarkdownViewer・HttpSelector・defaultテンプレートを同じ版に更新して検証する。

## エラーと更新互換性

- 設定欠落、未知の項目、別ストア、Publisher／拇印不一致、秘密鍵欠落、Code Signing用途なし、デジタル署名不可、有効期間外では停止する。
- 期限まで90日以下は警告、7日以下は停止する。自動更新・自動発行は行わない。
- MarkdownViewerは既存の署名者・Publisherを維持するので、この整備によるIdentity変更はない。
- HttpSelectorの旧開発版は`CN=HttpSelector Development`だった。共通Publisherへの変更でPackage Familyが変わり、旧版への上書き更新やLocalState共有はできない。次回の新しい版で別インストールとして受入し、必要な設定の退避・移行を確認する。今回、旧成果物・旧証明書・インストール済みアプリは変更しない。
- Store版はPartner CenterのIdentityを使い、共通自己署名証明書へ置換しない。

## キーの保管とバックアップ

秘密鍵の実体はWindowsのユーザー鍵ストレージが管理する。証明書ストアの秘密鍵を削除したり、ユーザープロファイルを初期化したりしない。
現行キーはエクスポート可能な設定で作られている。今回その属性を変更せず、PFXバックアップも自動作成しない。
バックアップが既に存在することは確認していない。

PC故障・交換に備える場合は、明示的なバックアップ作業として、強いパスワードで暗号化したPFXを
アクセス制限されたオフライン媒体へ保存し、パスワードは別の安全な保管先で管理する。
パスワードをコマンドライン、ログ、JSONへ書かず、`Read-Host -AsSecureString`等の対話入力を使う。
リポジトリ・Web公開領域・平文PFX・秘密鍵と同じ場所のパスワード保存は避ける。復元確認は別の検証環境で行う。
共通キーの漏えいは、このキーで署名する全アプリに影響する。紛失・漏えい・更新では全アプリの移行計画が必要。

## 根拠

- [Microsoft: SignToolによる署名とPublisher一致条件](https://learn.microsoft.com/en-us/windows/win32/appxpkg/how-to-sign-a-package-using-signtool)
- [Microsoft: Package IdentityとPackage Family](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/package-identity-overview)
