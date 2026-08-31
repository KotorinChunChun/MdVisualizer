# MSIX packaging

Windows SDKの`MakeAppx.exe`と`SignTool.exe`を使い、x64版のMarkdownViewerをMSIXへまとめる。

## 自己署名版を作る

```powershell
pwsh -NoProfile -File .\scripts\publish-MarkdownViewer.ps1 -Mode Build -Channel beta -ReleaseIntentConfirmed
```

`release\msix`へ署名済み`.msix`と公開鍵`MarkdownViewer.cer`を出力する。公開鍵のファイル名は
バージョンにかかわらず固定し、同じ証明書を使用している間は既存ファイルを再利用する。
署名はPC共通設定 `%LOCALAPPDATA%\KotorinChunChun\MSIX\signing.json` の拇印で指定した
`CurrentUser\My` の証明書を使用する。秘密鍵はWindows管理下に保持し、アプリごとには作らない。
共通設定なし・鍵欠落・期限切れでは停止し、証明書を自動発行しない。

共通設定の初期登録と他アプリへの導入は[PC共通MSIX署名](MSIX_SIGNING.md)を参照する。
下位スクリプトの`-CertificateThumbprint`は共通設定と同じ値だけを許可する。別証明書への切替には使用しない。

```powershell
pwsh -NoProfile -File .\scripts\initialize-msix-signing.ps1 `
  -CertificateThumbprint "475BABC3C3D1E871D90503D45CC5236216D85EE8" `
  -Publisher "CN=KotorinChunChun"
```

開発用証明書はOSに信頼されていない。内容を確認したうえで、現在のユーザーの`TrustedPeople`へ
証明書を登録してインストールする場合は次を実行する。

```powershell
pwsh -NoProfile -File .\scripts\install-msix.ps1 -TrustDevelopmentCertificate
```

証明書を信頼せずに`.msix`だけを直接実行してもインストールできない。開発用証明書を信頼する操作は
検証端末だけで行う。

証明書ストアの秘密鍵は将来の更新署名に必要である。秘密鍵を削除せず、必要に応じてアクセス制限された
場所へPFXバックアップを作成する。PFXやパスワードをリポジトリとWeb公開領域へ保存しない。

## beta App Installerを作る

MSIX生成後、beta更新チャネルの`.appinstaller`を生成する。

```powershell
pwsh -NoProfile -File .\scripts\build-appinstaller.ps1 `
  -MsixPath .\release\msix\MarkdownViewer_0.0.9.0_x64.msix `
  -ChannelBaseUri "https://excel-chunchun.sakura.ne.jp/download/beta/"
```

起動時に毎回更新を確認するが、現在の起動はブロックしない。更新されたMSIXは次回起動時に使用される。
betaと正式版は別のApp Installer URIを使用し、Package Identityと署名証明書は共通にする。

## 本番署名版を作る

本PCのStore外署名は共通証明書を使用する。個別PFX・パスワード引数とPublisherの自動上書きを廃止した。
有料証明書や別PCへ移行する場合は、全アプリのPublisher・利用者側の信頼・更新経路を確認してから
証明書ストアと共通設定を移行する。共通化だけで公的に信頼された署名になるわけではない。

Microsoft Storeへ提出する場合は、Partner Centerで割り当てられたIdentityとPublisherへ変更し、Storeの
署名フローを使用する。

## 前提と制約

- Windows 10 2004（build 19041）以降のx64環境を対象とする。
- Windows SDK 10のx64版`MakeAppx.exe`と`SignTool.exe`が必要。
- WebView2 RuntimeはOS側にインストール済みであること。
- `.md`、`.markdown`、`.svg`、`.mmd`、`.mermaid`を関連付け対象として登録する。
- MSIXの更新にはIdentity、Publisher、アーキテクチャを維持し、4要素のVersionを増加させる。
