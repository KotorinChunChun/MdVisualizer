# MdVisualizer スクリプト一覧

## スクリプトの呼び出し関係

```text
packaging/release-config.json（Version正本）
  ├─ 製品ビルドVersion・MSIX Version・公開表示Version
  ├─ Invoke-MdVisualizerRelease.ps1（開始直後に履歴版を決定）
  └─ Invoke-Validate-MdVisualizer-all.ps1 / publish-web-MdVisualizer-limited.ps1
     （同じ設定から履歴版を決定）

利用者向けbeta入口（すべて引数なし）
  plan-release-MdVisualizer.ps1   ─┐
  build-release-MdVisualizer.ps1  ─┤
  stage-release-MdVisualizer.ps1  ─┤
  publish-release-MdVisualizer.ps1─┤
  verify-release-MdVisualizer.ps1 ─┤
  full-release-MdVisualizer.ps1   ─┤
                                  │
正式リリース用stable入口（1個）  │
  full-release-stable-MdVisualizer.ps1
                                  │
既存互換入口                      │
  publish-release-MdVisualizer-all.ps1 ─┤
  publish-MdVisualizer.ps1             ─┘
                                           ▼
                             Invoke-MdVisualizerRelease.ps1
                                           │
                  ┌────────────────────────┼────────────────────────┐
                  ▼                        ▼                        ▼
       package-MdVisualizer-msix.ps1  stage-msix-release.ps1  verify-msix-release.ps1
       package-MdVisualizer-          package-MdVisualizer-  FTP公開・公開後検証
       appinstaller.ps1               portable.ps1

SPFx系統（共通リリースエンジンとは別系統）
  build-release-MdVisualizer-spfx.ps1 → publish-release-MdVisualizer-spfx.ps1
```

betaの工程別入口はすべてbetaに固定している。stableを正式公開するときだけ、`full-release-stable-MdVisualizer.ps1`を使用する。stable入口は、設定がbetaのままではビルドを開始せず、`packaging/release-config.json`をstable用Versionへ更新するよう停止する。

バージョン更新は`update-version-MdVisualizer.ps1`を使用する。現在のbeta版を表示した後、4桁版を入力すると、公開表示版、内部版、MSIX版、SPFx版、lockファイル、配布ページを各用途の表記へ変換して更新する。更新前の整合性検査と、更新後の旧版表記検索も自動で行う。履歴版は4桁目を除いた`vX.Y.Z`として扱う。

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

リリース工程の共通処理は`Invoke-MdVisualizerRelease.ps1`に集約している。`-Mode`には`Plan`、`Build`、`Stage`、`Publish`、`Verify`、`Full`を指定できる。通常利用する工程別入口はすべてbeta固定で、追加パラメーターなしで実行する。

| スクリプト | 共通処理へ渡すモード | 用途 |
|---|---|---|
| `plan-release-MdVisualizer.ps1` | `Plan` | 版・署名・公開先の計画表示。読み取り専用。 |
| `build-release-MdVisualizer.ps1` | `Build` | production成果物を生成する。 |
| `stage-release-MdVisualizer.ps1` | `Stage` | 成果物を公開用ステージへ配置する。 |
| `publish-release-MdVisualizer.ps1` | `Publish` | 指定チャンネルへ公開する。 |
| `verify-release-MdVisualizer.ps1` | `Verify` | ローカルまたは公開前成果物を検証する。 |
| `full-release-MdVisualizer.ps1` | `Full` | betaのビルドから公開後検証までを実行する。 |

`full-release-stable-MdVisualizer.ps1`は、将来の正式リリース用にstableのビルドから公開後検証までを一括実行する唯一の利用者向け入口である。stable公開は通常の工程別入口へ追加しない。`publish-release-MdVisualizer-all.ps1`は既存名を維持した互換入口であり、従来どおり`-Mode`を指定できる。旧`publish-MdVisualizer.ps1`も互換転送だけを行う。共通エンジンと互換入口の確認スイッチは、通常利用の工程別入口では内部的に付加する。

フルパスでの実行例:

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\plan-release-MdVisualizer.ps1"
```

各PowerShellスクリプトは、1つのコードブロックに1つずつ記載する。

### バージョン更新

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\update-version-MdVisualizer.ps1"
```

### 起動

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\run-debug-MdVisualizer-all.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\run-debug-MdVisualizer-all-sample.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\run-debug-MdVisualizer-all-smoke.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\run-release-MdVisualizer-all.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\run-exe-MdVisualizer-all.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\run-exe-MdVisualizer-all-sample.ps1"
```

### リリース共通エンジンと工程別入口

betaの工程別入口は追加パラメーターなしで実行する。

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\plan-release-MdVisualizer.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\build-release-MdVisualizer.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\stage-release-MdVisualizer.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\verify-release-MdVisualizer.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\publish-release-MdVisualizer.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\full-release-MdVisualizer.ps1"
```

stableの正式リリースは、次の一括入口だけを使用する。

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\full-release-stable-MdVisualizer.ps1"
```

### 既存の互換入口

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\publish-release-MdVisualizer-all.ps1" -Mode Plan
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\publish-MdVisualizer.ps1" -Mode Plan
```

### SPFx、配布物生成、検証

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\build-release-MdVisualizer-spfx.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\build-spfx.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\publish-release-MdVisualizer-spfx.ps1" -PublishConfirmed
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\package-MdVisualizer-msix.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\package-MdVisualizer-appinstaller.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\package-MdVisualizer-portable.ps1" -ReleaseIntentConfirmed
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\build-msix.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\build-appinstaller.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\Invoke-Validate-MdVisualizer-all.ps1"
```

```powershell
pwsh -NoProfile -File "C:\develop\MdVisualizer\scripts\publish-web-MdVisualizer-limited.ps1" -Mode Plan
```

`Version`を省略した場合は、スクリプト開始時に`packaging/release-config.json`から履歴版を決定する。ビルド版の4桁目は履歴フォルダー名に含めず、`vX.Y.Z`形式の3桁版を使用する。
`build-release-MdVisualizer-spfx.ps1`はSPFx packageをローカル生成し、外部変更を行わない。`publish-release-MdVisualizer-spfx.ps1`は`-PublishConfirmed`を必須とし、既定ではApp Catalogへの上書きアップロードまでを行う。全サイト展開は`-Deploy`を明示した場合だけ行う。ルートの`build-spfx.ps1`はローカルビルド専用の互換入口である。

## 補助スクリプト

`build-*`、`stage-*`、`verify-*`、`install-*`、`Invoke-*`、`*-smoke.mjs`は、起動用エントリポイントから呼び出す補助、成果物生成、検証、またはテスト実装であり、通常のアプリ起動用ではない。

ローカル配布物生成は`package-MdVisualizer-msix.ps1`と`package-MdVisualizer-appinstaller.ps1`を正規名とする。旧`build-msix.ps1`と`build-appinstaller.ps1`は互換転送だけを行い、外部公開は行わない。
`package-MdVisualizer-portable.ps1 -ReleaseIntentConfirmed`はproduction実行ファイルの版を確認してZIPを生成し、収録ファイルとハッシュを検証する。公開入口は配布ルート全体を送らず、本製品のサイト正本・MSIX・CER・App Installer・ZIPだけを送信する。

## 単一HTML出力CLI

`export-html.mjs`は、アプリを起動せずMarkdownを閲覧専用の単一HTMLへ変換する独立CLIです。引数と使い方は[HTML出力CLI](/docs/user/HTML_EXPORT_CLI.md)を参照してください。

## 統合検証と限定Web公開

`Invoke-Validate-MdVisualizer-all.ps1` と `publish-web-MdVisualizer-limited.ps1` の対象指定、結果集計、UI基準更新、排他制御は[自動化手順](/docs/developer/operations/02-development-automation.md)を参照する。
