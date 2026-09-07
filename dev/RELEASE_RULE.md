# MarkdownViewer リリース手順

本書はMarkdownViewer固有の配布・公開手順の正本です。汎用テンプレートではなく、現行リポジトリに実在する経路だけを記載します。

## 対象と許可

- 通常の対象はbeta版です。stable版はユーザーが方針変更またはstableリリースを明示した場合だけ扱います。
- 単に「リリースしてください。」と依頼された場合の範囲は、ルート`AGENTS.md`の「リリース省略指示」を正本とします。
- 計画、レビュー、ルール適用、ビルド確認から、署名、App Catalog変更、FTP公開、インストールの許可を推測しません。
- 秘密鍵、PFX、パスワード、認証情報をリポジトリ、Web公開領域、ログへ保存しません。

## 成果物

| 成果物 | ローカル配置 | 公開・更新先 |
|---|---|---|
| SPFx package | `spfx/sharepoint/solution/spfx-markdown-editor.sppkg` | 既存のサイトコレクションApp Catalog |
| ポータブルZIP | `release/`配下 | Websiteリポジトリの既存ポータブル版配布先 |
| 署名済みMSIX | `release/msix/` | beta配布サイトの版付きMSIX |
| App Installer | `release/msix/` | beta配布サイトの固定App Installer URL |
| 公開用証明書 | `release/msix/MarkdownViewer.cer` | 秘密鍵を含まない固定名CER |

`release/`はGit対象外です。配布サイトへ置くファイルはWebsiteリポジトリへ対象差分だけをステージし、既存のガード付き公開処理でアップロードします。

## 署名

Store外MSIXは、このPCの`%LOCALAPPDATA%\KotorinChunChun\MSIX\signing.json`が示す`CurrentUser\My`の共通証明書を使用します。Publisherは`CN=KotorinChunChun`です。設定なし、秘密鍵なし、期限切れでは停止し、自動発行、Friendly Nameによる別証明書選択、個別PFXへのフォールバックを行いません。

詳細は`packaging/msix/MSIX_SIGNING.md`と`packaging/msix/README.md`を参照します。信頼登録、インストール、証明書交換、鍵のエクスポートは別作業です。

## 検証とビルド

公開前に、対象変更に応じて次を実行します。

```powershell
npm.cmd test
npm.cmd run build
cargo test --manifest-path .\src-tauri\Cargo.toml
npm.cmd --prefix .\spfx test
npm.cmd run build:spfx:local
npm.cmd run release:test-safety
```

当該PCではGUIテストを行いません。実WebView、印刷画面、実SharePointの利用者操作は別PCまたは専用runnerの受入として分離します。

## SPFx

ローカル確認は`npm.cmd run build:spfx:local`を使用し、App Catalogを変更しません。公開時は`scripts/publish-release-MarkdownViewer-spfx.ps1 -PublishConfirmed`で`sppkg`を上書きアップロードし、版、solution ID、package妥当性、App Catalog状態を検証します。

アップロードだけの依頼には全サイト展開を含めません。展開はユーザーが明示した場合だけ実行します。

## MSIX・App Installer・配布サイト

`scripts/publish-release-MarkdownViewer-all.ps1`は現行のガード付きMSIX／App Installer統合入口です。読み取り専用の計画確認と、Build、Stage、Publish、Verify、Fullを分離し、変更を伴うmodeでは確認スイッチを要求します。旧`publish-MarkdownViewer.ps1`は互換転送だけを行います。実行例と設定は`packaging/msix/README.md`および`packaging/release-config.json`を正本とします。

公開時は、Websiteリポジトリの既存差分を保護し、対象ファイルだけをコミットします。既定のFTP先は`/download/`と`/download/beta/`です。配布記事の表示版、MSIX版、公開日、App Installerリンク、版付きMSIX直接リンクをbeta版へ揃え、stable版の準備中表示を維持します。

## 公開後検証

- アプリ版、MSIX版、Identity、Publisher、署名、証明書拇印、SHA-256
- SPFx package版、solution ID、`SkipFeatureDeployment`、App Catalog状態
- 公開URLのHTTP status、MIME、Content-Length、取得ファイルのハッシュ
- 配布記事の表示版、公開日、App Installerリンク、版付きMSIXリンク
- App InstallerのURIと参照先MSIXの版・URI

生成だけ、ステージングだけ、アップロードだけをフルリリース完了として記録しません。失敗または未実施の工程は対象版の`imp.md`と`task.md`へ残します。
