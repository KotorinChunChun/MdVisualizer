# MSIX packaging

Windows SDKの`MakeAppx.exe`と`SignTool.exe`を使い、x64版のMarkdownViewerをMSIXへまとめる。

## 開発署名版を作る

```powershell
pwsh -NoProfile -File .\scripts\build-msix.ps1
```

`release\msix`へ署名済み`.msix`と公開鍵`.cer`を出力する。秘密鍵を含む一時PFXは
`src-tauri\target\msix`内で生成し、署名完了後に削除する。

開発用証明書はOSに信頼されていない。内容を確認したうえで、現在のユーザーの`TrustedPeople`へ
証明書を登録してインストールする場合は次を実行する。

```powershell
pwsh -NoProfile -File .\scripts\install-msix.ps1 -TrustDevelopmentCertificate
```

証明書を信頼せずに`.msix`だけを直接実行してもインストールできない。開発用証明書を信頼する操作は
検証端末だけで行う。

## 本番署名版を作る

正式なコード署名証明書をPFXで指定する。マニフェストのPublisherは証明書のSubjectから自動設定する。

```powershell
pwsh -NoProfile -File .\scripts\build-msix.ps1 `
  -PfxPath C:\secure\publisher.pfx `
  -PfxPassword "<password>" `
  -TimestampUrl "<RFC 3161 timestamp URL>"
```

コマンドライン引数のパスワードはプロセス一覧や履歴へ残る可能性がある。CIではシークレット管理された
一時環境から実行し、PFXとパスワードをリポジトリへ保存しない。

Microsoft Storeへ提出する場合は、Partner Centerで割り当てられたIdentityとPublisherへ変更し、Storeの
署名フローを使用する。

## 前提と制約

- Windows 10 2004（build 19041）以降のx64環境を対象とする。
- Windows SDK 10のx64版`MakeAppx.exe`と`SignTool.exe`が必要。
- WebView2 RuntimeはOS側にインストール済みであること。
- `.md`、`.markdown`、`.svg`、`.mmd`、`.mermaid`を関連付け対象として登録する。
- MSIXの更新にはIdentity、Publisher、アーキテクチャを維持し、4要素のVersionを増加させる。
