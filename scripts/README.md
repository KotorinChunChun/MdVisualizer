# MdVisualizer スクリプト一覧

## 起動用スクリプト

| スクリプト | 用途 |
|---|---|
| `run-debug-MdVisualizer-all.ps1` | 全機能をデバッグビルドして起動する。 |
| `run-debug-MdVisualizer-all-sample.ps1` | `samples/sample.md`を使用して全機能をデバッグ起動する。`-TestFile`で変更できる。 |
| `run-debug-MdVisualizer-all-smoke.ps1` | デバッグ再ビルド後に実画面スモークを実行する。GUIテストを行わない当該PCでは使用しない。 |
| `run-release-MdVisualizer-all.ps1` | 全機能をリリースビルドし、生成した実行ファイルを起動する。 |
| `run-exe-MdVisualizer-all.ps1` | ビルド済み実行ファイルを起動する。既定はrelease、`-Configuration debug`も指定できる。 |
| `run-exe-MdVisualizer-all-sample.ps1` | `samples/sample.md`を使用してビルド済み実行ファイルを起動する。 |

起動せず処理内容だけを確認する場合は、各スクリプトへ`-WhatIf`を指定する。

## 公開用スクリプト

`publish-release-MdVisualizer-all.ps1`はMSIX／App Installerのガード付き公開エントリポイントである。既定の`Plan`は読み取り専用で、ビルドや公開には確認スイッチが必要となる。旧`publish-MdVisualizer.ps1`は互換転送だけを行う。

`build-release-MdVisualizer-spfx.ps1`はSPFx packageをローカル生成し、外部変更を行わない。`publish-release-MdVisualizer-spfx.ps1`は`-PublishConfirmed`を必須とし、既定ではApp Catalogへの上書きアップロードまでを行う。全サイト展開は`-Deploy`を明示した場合だけ行う。ルートの`build-spfx.ps1`はローカルビルド専用の互換入口である。

## 補助スクリプト

`build-*`、`stage-*`、`verify-*`、`install-*`、`Invoke-*`、`*-smoke.mjs`は、起動用エントリポイントから呼び出す補助、成果物生成、検証、またはテスト実装であり、通常のアプリ起動用ではない。

ローカル配布物生成は`package-MdVisualizer-msix.ps1`と`package-MdVisualizer-appinstaller.ps1`を正規名とする。旧`build-msix.ps1`と`build-appinstaller.ps1`は互換転送だけを行い、外部公開は行わない。
`package-MdVisualizer-portable.ps1 -ReleaseIntentConfirmed`はproduction実行ファイルの版を確認してZIPを生成し、収録ファイルとハッシュを検証する。公開入口は配布ルート全体を送らず、本製品のサイト正本・MSIX・CER・App Installer・ZIPだけを送信する。

## 単一HTML出力CLI

`export-html.mjs`は、アプリを起動せずMarkdownを閲覧専用の単一HTMLへ変換する独立CLIです。引数と使い方は[HTML出力CLI](/docs/user/HTML_EXPORT_CLI.md)を参照してください。

## 統合検証と限定Web公開

`Invoke-Validate-MdVisualizer-all.ps1` と `publish-web-MdVisualizer-limited.ps1` の対象指定、結果集計、UI基準更新、排他制御は[自動化手順](/docs/developer/operations/02-development-automation.md)を参照する。
