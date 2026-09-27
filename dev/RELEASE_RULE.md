# MdVisualizer リリース手順

本書はMdVisualizer固有の配布・公開手順の正本です。汎用テンプレートではなく、現行リポジトリに実在する経路だけを記載します。

## 対象と許可

- 通常の対象はbeta版です。stable版はユーザーが方針変更またはstableリリースを明示した場合だけ扱います。
- 単に「リリースしてください。」と依頼された場合の範囲は、ルート`AGENTS.md`の「リリース省略指示」を正本とします。
- 計画、レビュー、ルール適用、ビルド確認から、署名、App Catalog変更、FTP公開、インストールの許可を推測しません。
- 秘密鍵、PFX、パスワード、認証情報をリポジトリ、Web公開領域、ログへ保存しません。

## 成果物

| 成果物 | ローカル配置 | 公開・更新先 |
|---|---|---|
| SPFx package | `spfx/sharepoint/solution/spfx-mdvisualizer.sppkg` | 既存のサイトコレクションApp Catalog |
| ポータブルZIP | `release/`配下 | Websiteリポジトリの既存ポータブル版配布先 |
| 署名済みMSIX | `release/msix/` | beta配布サイトの版付きMSIX |
| App Installer | `release/msix/` | beta配布サイトの固定App Installer URL |
| 公開用証明書 | `release/msix/MdVisualizer.cer` | 秘密鍵を含まない固定名CER |

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

GUIテストの可否は最新のAGENTS.mdに従います。当該PCでは実画面確認が許可されています。実WebView、印刷画面、実SharePointの利用者操作は、自動テストや成果物生成とは別に実施結果を記録します。

## SPFx

ローカル確認は`npm.cmd run build:spfx:local`を使用し、App Catalogを変更しません。公開時は`scripts/publish-release-MdVisualizer-spfx.ps1 -PublishConfirmed`で`sppkg`を上書きアップロードし、版、solution ID、package妥当性、App Catalog状態を検証します。

アップロードだけの依頼には全サイト展開を含めません。展開はユーザーが明示した場合だけ実行します。

## MSIX・App Installer・配布サイト

通常のbeta公開は、Version更新後に`scripts/plan-release-MdVisualizer.ps1`で計画を確認し、問題がなければ`scripts/full-release-MdVisualizer.ps1`を実行します。この入口はbetaに固定され、productionテスト、MSIX／App Installer／ポータブル成果物生成、ステージング、beta FTP公開、公開後検証までを一括実行します。stable公開は保留とし、将来明示的に正式リリースするときだけ`scripts/full-release-stable-MdVisualizer.ps1`を使用します。

Planの出力には計画表示用としてbetaとstableのURLが併記されますが、Planは読み取り専用で、beta入口からstableへアップロードされることを意味しません。同じVersionを`update-version-MdVisualizer.ps1`へ再指定すると、入力版が現在版より新しくないため停止します。

Build／Stage完了後にPython未検出でPublishが停止した場合は、生成済み成果物を再作成せず、`Invoke-MdVisualizerRelease.ps1 -Mode Publish -Channel beta`へPythonの絶対パスと確認スイッチを渡して公開工程だけを再実行します。`Resolve-PythonExecutable`がPATH上のPythonを見つけられない環境では、Scoopなどの`python.exe`を明示します。旧`scripts/publish-release-MdVisualizer-all.ps1`と`publish-MdVisualizer.ps1`は互換転送入口として残しています。実行例と設定は`packaging/msix/README.md`および`packaging/release-config.json`を正本とします。

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\update-version-MdVisualizer.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\plan-release-MdVisualizer.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\full-release-MdVisualizer.ps1"
```

```powershell
$pythonPath = Get-ChildItem -LiteralPath "$env:USERPROFILE\scoop\apps\python" -Filter "python.exe" -Recurse -File | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\Invoke-MdVisualizerRelease.ps1" -Mode Publish -Channel beta -ReleaseIntentConfirmed -PublishConfirmed -PythonPath $pythonPath
```

公開時は、Websiteリポジトリの既存差分を保護し、対象ファイルだけをコミットします。既定のFTP先は`/download/`と`/download/beta/`です。配布記事の表示版、MSIX版、公開日、App Installerリンク、版付きMSIX直接リンクをbeta版へ揃え、stable版の準備中表示を維持します。

## 公開後検証

- アプリ版、MSIX版、Identity、Publisher、署名、証明書拇印、SHA-256
- SPFx package版、solution ID、`SkipFeatureDeployment`、App Catalog状態
- 公開URLのHTTP status、MIME、Content-Length、取得ファイルのハッシュ
- 配布記事の表示版、公開日、App Installerリンク、版付きMSIXリンク
- App InstallerのURIと参照先MSIXの版・URI

生成だけ、ステージングだけ、アップロードだけをフルリリース完了として記録しません。失敗または未実施の工程は対象版の`imp.md`と`task.md`へ残します。
