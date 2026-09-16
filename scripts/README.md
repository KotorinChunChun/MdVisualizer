# MdVisualizer スクリプト一覧

## 起動用スクリプト

| スクリプト | 用途 |
|---|---|
| `run-debug-MdVisualizer-all.ps1` | 全機能をデバッグビルドして起動する。 |
| `run-debug-MdVisualizer-all-sample.ps1` | `samples/sample.md`を使用して全機能をデバッグ起動する。`-TestFile`で変更できる。 |
| `run-debug-MdVisualizer-all-smoke.ps1` | デバッグ再ビルド後に実画面スモークを実行する。実行可否と未保存文書保護は最新のAGENTS.mdに従う。 |
| `run-release-MdVisualizer-all.ps1` | 全機能をリリースビルドし、生成した実行ファイルを起動する。 |
| `run-exe-MdVisualizer-all.ps1` | ビルド済み実行ファイルを起動する。既定はrelease、`-Configuration debug`も指定できる。 |
| `run-exe-MdVisualizer-all-sample.ps1` | `samples/sample.md`を使用してビルド済み実行ファイルを起動する。 |

起動せず処理内容だけを確認する場合は、各スクリプトへ`-WhatIf`を指定する。

## 公開用スクリプト

### リリース工程の共通入口

リリース工程の共通処理は`Invoke-MdVisualizerRelease.ps1`に集約している。`-Mode`には`Plan`、`Build`、`Stage`、`Publish`、`Verify`、`Full`を指定できる。各工程をファイル名で選ぶ場合は、次の薄い入口を使う。

| スクリプト | 共通処理へ渡すモード | 用途 |
|---|---|---|
| `plan-release-MdVisualizer.ps1` | `Plan` | 版・署名・公開先の計画表示。読み取り専用。 |
| `build-release-MdVisualizer.ps1` | `Build` | production成果物を生成する。 |
| `stage-release-MdVisualizer.ps1` | `Stage` | 成果物を公開用ステージへ配置する。 |
| `publish-release-MdVisualizer.ps1` | `Publish` | 指定チャンネルへ公開する。 |
| `verify-release-MdVisualizer.ps1` | `Verify` | ローカルまたは公開前成果物を検証する。 |
| `full-release-MdVisualizer.ps1` | `Full` | ビルドから公開後検証までを実行する。 |

`publish-release-MdVisualizer-all.ps1`は既存名を維持した互換入口であり、従来どおり`-Mode`を指定できる。旧`publish-MdVisualizer.ps1`も互換転送だけを行う。`Build`、`Stage`、`Publish`、`Full`では`-Channel`と`-ReleaseIntentConfirmed`が必要で、`Publish`と`Full`ではさらに`-PublishConfirmed`が必要となる。`Verify`は`-Channel`が必要ですが、共通エンジンの既存仕様どおりリリース意図確認は必須ではありません。整理確認ではこれらのモードを実行しない。

フルパスでの実行例:

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\plan-release-MdVisualizer.ps1"
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\build-release-MdVisualizer.ps1" -Channel beta -ReleaseIntentConfirmed
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\publish-release-MdVisualizer.ps1" -Channel beta -ReleaseIntentConfirmed -PublishConfirmed
```

各PowerShellスクリプトをフルパスで実行する場合は、次のコマンドを使用する。

### 起動

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\run-debug-MdVisualizer-all.ps1"
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\run-debug-MdVisualizer-all-sample.ps1"
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\run-debug-MdVisualizer-all-smoke.ps1"
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\run-release-MdVisualizer-all.ps1"
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\run-exe-MdVisualizer-all.ps1"
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\run-exe-MdVisualizer-all-sample.ps1"
```

### リリース共通エンジンと工程別入口

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\Invoke-MdVisualizerRelease.ps1" -Mode Plan
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\plan-release-MdVisualizer.ps1"

pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\build-release-MdVisualizer.ps1" `
  -Channel beta `
  -ReleaseIntentConfirmed

pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\stage-release-MdVisualizer.ps1" `
  -Channel beta `
  -ReleaseIntentConfirmed

pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\verify-release-MdVisualizer.ps1" `
  -Channel beta

pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\publish-release-MdVisualizer.ps1" `
  -Channel beta `
  -ReleaseIntentConfirmed `
  -PublishConfirmed

pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\full-release-MdVisualizer.ps1" `
  -Channel beta `
  -ReleaseIntentConfirmed `
  -PublishConfirmed
```

既存の互換入口を実行する場合:

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\publish-release-MdVisualizer-all.ps1" -Mode Plan
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\publish-MdVisualizer.ps1" -Mode Plan
```

### SPFx、配布物生成、検証

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\build-release-MdVisualizer-spfx.ps1"
pwsh -NoProfile -File "C:\develop\MdVisualizer\build-spfx.ps1"
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\publish-release-MdVisualizer-spfx.ps1" -PublishConfirmed

pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\package-MdVisualizer-msix.ps1"
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\package-MdVisualizer-appinstaller.ps1"
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\package-MdVisualizer-portable.ps1" -ReleaseIntentConfirmed

pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\build-msix.ps1"
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\build-appinstaller.ps1"
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\Invoke-Validate-MdVisualizer-all.ps1"
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\publish-web-MdVisualizer-limited.ps1"
```

`build-release-MdVisualizer-spfx.ps1`はSPFx packageをローカル生成し、外部変更を行わない。`publish-release-MdVisualizer-spfx.ps1`は`-PublishConfirmed`を必須とし、既定ではApp Catalogへの上書きアップロードまでを行う。全サイト展開は`-Deploy`を明示した場合だけ行う。ルートの`build-spfx.ps1`はローカルビルド専用の互換入口である。

## 補助スクリプト

`build-*`、`stage-*`、`verify-*`、`install-*`、`Invoke-*`、`*-smoke.mjs`は、起動用エントリポイントから呼び出す補助、成果物生成、検証、またはテスト実装であり、通常のアプリ起動用ではない。

ローカル配布物生成は`package-MdVisualizer-msix.ps1`と`package-MdVisualizer-appinstaller.ps1`を正規名とする。旧`build-msix.ps1`と`build-appinstaller.ps1`は互換転送だけを行い、外部公開は行わない。
`package-MdVisualizer-portable.ps1 -ReleaseIntentConfirmed`はproduction実行ファイルの版を確認してZIPを生成し、収録ファイルとハッシュを検証する。公開入口は配布ルート全体を送らず、本製品のサイト正本・MSIX・CER・App Installer・ZIPだけを送信する。

## 単一HTML出力CLI

`export-html.mjs`は、アプリを起動せずMarkdownを閲覧専用の単一HTMLへ変換する独立CLIです。引数と使い方は[HTML出力CLI](/docs/user/HTML_EXPORT_CLI.md)を参照してください。

## 統合検証と限定Web公開

`Invoke-Validate-MdVisualizer-all.ps1` と `publish-web-MdVisualizer-limited.ps1` の対象指定、結果集計、UI基準更新、排他制御は[自動化手順](/docs/developer/operations/02-development-automation.md)を参照する。
