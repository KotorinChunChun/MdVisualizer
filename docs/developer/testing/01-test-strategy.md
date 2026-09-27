# 検証手順

実行条件は[AGENTS.md](../../../AGENTS.md)、コマンドは[ビルド・検証](/docs/developer/BUILD_COMMANDS.md)を参照する。必要な変更領域だけを検証し、結果は対象版の実装報告へ記録する。

- frontend: npm.cmd test。限定できる場合は対象testファイルを指定する。
- Rust: cargo test --manifest-path ./src-tauri/Cargo.toml。
- [内部PDF](/docs/developer/testing/03-internal-pdf.md)、[Diff](/docs/developer/testing/04-document-diff.md)は各手順に従う。
- ボタン静的検査: npm.cmd run test:button-style-rules。
- 編集テスト結果HTML: npm.cmd run report:editing -- --version v0.0.18。版は今回の対象に置き換える。
- 日常の実画面確認: `run-debug-MdVisualizer-all.ps1`を継続起動しHMRで反映する。詳細は[ビルド・検証](/docs/developer/BUILD_COMMANDS.md)へ。
- 機能完了時・公開前のGUI受入: npm.cmd run debug:smoke -- -TargetVersion v0.0.18。例の版を対象版へ置き換え、既存の未保存文書を保護する。
- 埋め込み画像の性能回帰: [性能回帰測定](/docs/developer/testing/06-performance-regression.md)。100枚・500×500画像のロード時間とスクロール時間を基準値と比較する。
- ローカルリンク、対象版・ブランチ、AIメニューの対象範囲も変更に応じて確認する。

生ログ・動画・台帳・生成結果の保存先は生成スクリプトが対象版から決定する。対象版をスクリプトの引数またはMDVISUALIZER_VERSIONで指定する。利用者向けHTML出力CLIの保存先や配布パッケージのreleaseは、検証ログとは別の製品契約である。

SPFxの実行は[保留案](../../../dev/PLAN_IDEAS.md)の再開指示に従う。計画に書かれているだけの試験を実装済みとしない。

## 変更に応じた検証の選び方

| 変更領域 | 自動検証 | 実操作で補う範囲 |
|---|---|---|
| Markdown変換・状態遷移 | Vitest、共有coreの同一入力と期待値 | 図・表の見え方 |
| 編集・コピー・AIパネル | Testing Libraryで選択、非同期、取消、失敗復旧 | 入力先、右クリック、クリップボード、IME |
| ファイル保存・Tauri境界 | Rustで競合、権限、破損、失敗時の原本保持 | 実ファイル、未保存文書、外部更新 |
| 印刷・PDF | test:print-pdfによるPDF内容と画面復元 | OS印刷ダイアログと実際の出力先 |
| 配布スクリプト | release:test-safety、Plan/WhatIf、版整合 | 署名・取得物・インストールをそれぞれ確認 |

自動テストの成功、画面での受入、公開物の検証は別の証拠として扱う。ソース内の文字列一致だけで実動作の成功を判断しない。

## 回帰確認の具体的な観点

1. Diffの閲覧表示、3-wayの基準・ストレージ・採用結果、可変境界を確認する。図の構文エラーを修復すると表示が復旧すること、未解決競合を保存しないことを確認する。
2. AI履歴の保存失敗後、再保存成功・問題添付の除去で警告が解消するか確認する。同じ図への再操作、遅い画像準備中の会話切替、成功後だけの送信対象解除を試す。
3. 保存・再読込前後のスクロールと折畳、H1除外、選択取り込み、Markdown／プレーンコピー、本文・ALT直接編集とUndoを確認する。
4. テキスト・コード・PNG・Mermaid・draw.io・SVGごとにAIメニューの対象、新規会話、現在の会話への追加を確認する。

## 再現可能な入力と性能測定

固定seed、テストID、文字コード、改行、行列数、参照資産を記録する。日本語、絵文字、同じ文字の繰返し、空、破損、巨大入力、危険なHTML/SVG、参照欠落を含める。実ユーザーの秘密情報をfixtureに使わない。成功だけでなく、失敗時に原本・未保存内容・既存設定が保持されることを期待値にする。

性能は同じビルド構成・入力・環境でwarmup後に複数回測り、p50/p95と測定範囲を記録する。生成ケース件数をカバレッジ率や性能の代わりにしない。

埋め込み画像の固定負荷試験は、基準値を更新する場合と回帰を検出する場合を分ける。機能追加後は基準値を無条件に更新せず、まず既存基準との比較結果を確認する。

## 拡張時の設計資料

[テストケース設計](/docs/developer/testing/test-case-design.md)に正常・異常・境界のケース表を、[自動化と品質指標の設計案](/docs/developer/testing/automation-design.md)にレイヤー、fixture API、coverage・性能目標をまとめる。案に含まれるaxe、MSW、SQLite、専用CIなどを導入済みとは扱わない。実行入口はpackage.jsonと[ビルド・検証手順](/docs/developer/BUILD_COMMANDS.md)で確認する。
