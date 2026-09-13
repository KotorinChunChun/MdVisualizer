# 開発環境のセットアップとパッケージ作成

開発構成は[開発者ガイド](/docs/DEVELOPERS_GUIDE.md)、通常のビルド・検証コマンドは[ビルド手順](/docs/developer/BUILD_COMMANDS.md)を参照してください。

### Windows の初回セットアップ

開発モードで起動するには、次の開発環境が必要です。

- Node.js LTS（`node` と `npm`）
- Rustup（`cargo` と `rustc`）
- Visual Studio Build Tools の「Desktop development with C++」（Rust の Windows 向けビルドで必要になる場合があります）

Node.js と Rustup の導入後は PowerShell を開き直し、次のコマンドで確認してください。

```powershell
node --version
cargo --version
```

PowerShell の実行ポリシーによって `npm.ps1` がブロックされる環境では、`npm` の代わりに `npm.cmd` を使用します。

```powershell
Set-Location C:\develop\MdVisualizer
npm.cmd install
```

`npm.cmd` は Windows のコマンド版ランチャーであり、実行ポリシーを変更せずに使用できます。

開発時は次でサンプルを開きます。

```powershell
npm.cmd run tauri -- dev -- -- C:\develop\MdVisualizer\samples\sample.md
```

または、Markdown ファイルを引数に渡します。

```powershell
npm.cmd run tauri -- dev -- -- C:\Project\README.md C:\Project\design.markdown
```

開発中のアプリは `http://localhost:1420` のViteサーバーを表示します。起動したPowerShellを終了するとサーバーも停止するため、アプリには接続拒否画面が表示されます。`src-tauri\target\debug\mdvisualizer.exe` を単独で起動するのではなく、上記コマンドから起動してください。

リリース版は `.md`、`.markdown`、`.svg`、`.mmd`、`.mermaid`、`.drawio`、`.tsv` の関連付けを登録します。WindowsでMdVisualizerを開くアプリに選ぶと、対応する文書として開きます。MSIXでは形式別アイコンを登録します。

### MSIXインストーラー

Windows SDKが導入済みのx64 Windows環境では、次のコマンドで署名済みMSIXを生成できます。

```powershell
npm.cmd run package:msix
```

成果物は`release\msix`へ出力されます。既定では自己署名の開発用証明書を使用するため、証明書の内容を
確認し、検証端末の現在ユーザーだけで信頼してから導入します。

```powershell
pwsh -NoProfile -File .\scripts\install-msix.ps1 -TrustDevelopmentCertificate
```

#### 開発PCの共通署名

この署名証明書はMdVisualizer専用ではなく、開発PCで作成するStore外MSIX全体に使う
`KotorinChunChun`共通署名です。Publisherは`CN=KotorinChunChun`、秘密鍵は各PCの
`CurrentUser\My`に保持し、共通設定`%LOCALAPPDATA%\KotorinChunChun\MSIX\signing.json`の
拇印で証明書を選択します。PFXをリポジトリや各アプリへコピーしません。

新しい開発PCへ引き継ぐ場合は、移植元でバンドルを作成し、PFXのパスワードとは別経路で管理します。

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File C:\develop\default\dev\templates\export-msix-signing-bundle.ps1
```

移植先PCでは、バンドルフォルダーで次を実行します。PFXのパスワードと、証明書登録の確認として
`YES`を入力すると、現在のWindowsユーザーの`CurrentUser\My`と共通設定が初期化されます。
同時に、PFXを除く共通テンプレート一式が`C:\develop\default\dev\templates`へ自動コピーされます。
既存ファイルが異なる場合は上書きせず停止します。配置先を変更する場合は、次のように指定します。

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\import-msix-signing-bundle.ps1 `
  -TemplateDirectory C:\develop\default\dev\templates
```

移植後のMdVisualizerの署名は、リポジトリルートで次を実行します。テスト、Releaseビルド、MSIX署名、
beta用App Installer生成まで行います。

```powershell
pwsh -NoProfile -File .\scripts\publish-release-MdVisualizer-all.ps1 `
  -Mode Build -Channel beta -ReleaseIntentConfirmed
```

署名処理は`signing.json`の拇印で`CurrentUser\My`の証明書を選び、SHA-256でMSIXへ署名します。
証明書の表示名や自動選択は使用しません。別のアプリでも、Manifest Publisherを
`CN=KotorinChunChun`に合わせ、同じ共通署名設定を参照します。詳細は
[KotorinChunChun共通MSIX署名](../../packaging/msix/MSIX_SIGNING.md)を参照してください。

移植後にAIへMSIX作成を依頼する場合は、次の条件を伝えてください。

```text
このPCでは、Store外MSIXの署名にKotorinChunChun共通署名証明書を使用してください。
PublisherはCN=KotorinChunChun、証明書はCurrentUser\Myの秘密鍵付き証明書を使い、
%LOCALAPPDATA%\KotorinChunChun\MSIX\signing.jsonの拇印を参照してください。
個別PFXの使用やコピー、証明書の自動発行は行わず、既存の署名用ビルドスクリプトを使用してください。
TrustedPeopleへの登録、インストール、公開は別途明示した場合だけ行ってください。
```

配布・インストール時はPFXではなく、MSIXと秘密鍵を含まない`.cer`を使用します。自己署名証明書を
信頼するのは検証端末だけにし、必要な場合は次を実行します。

```powershell
pwsh -NoProfile -File .\scripts\install-msix.ps1 `
  -MsixPath .\release\msix\MdVisualizer_<バージョン>_x64.msix `
  -CertificatePath .\release\msix\MdVisualizer.cer `
  -TrustDevelopmentCertificate
```

詳しい生成・署名・導入手順と制約は[MSIX packaging README](../../packaging/msix/README.md)に記載しています。
対象はWindows 10 2004以降のx64環境で、WebView2 Runtimeが必要です。
