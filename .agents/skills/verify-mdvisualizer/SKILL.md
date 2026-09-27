---
name: verify-mdvisualizer
description: MdVisualizerの変更、対象版、受入状況をレビューし、変更領域に応じたVitest／Rust／共有core／SPFx／production build／性能検証を選択して証跡化する。総点検、回帰確認、テスト、実装レビューで使用し、修正実装やリリース公開には使用しない。
---

# MdVisualizerを検証する

検証済みの事実、自動化されていない受入、未確認事項を混同せず、要求への適合を判定する。

## 依頼を分類する

- 質問、レビュー、監査、状況確認ではコードや文書を変更しない。`AGENTS.md`、対象版の`req／imp／task`、`git diff`、実装と既存テストを読み、指摘を返す。
- 「テストして」「検証して」と明示された場合は、[検証マトリクス](references/validation-matrix.md)から必要十分なコマンドを選ぶ。公開、署名、upload、installは検証依頼に含めない。
- 「直して」まで含む場合は、このskillで不足を特定した後、`develop-mdvisualizer`へ切り替える。

## 評価手順

1. 最新の`AGENTS.md`と対象版の正本を確認し、受入項目を列挙する。古い版の方針を現行要求より優先しない。
2. `git status --short`と対象差分を確認し、変更を機能群、runtime、データ安全性、security、性能、UI受入へ分類する。
3. 既存テスト名だけで網羅と判断せず、正常、異常、境界、回帰の期待値が要求を直接観測しているか読む。保存、競合、securityでは失敗時の「元データ不変」も確認する。
4. 明示された検証範囲で、近いテストから横断ゲートへ広げる。共有coreの変更を片方の製品だけで検証しない。
5. [証跡と完了判定](references/evidence.md)に従って結果をまとめる。実行していない項目、環境上実行できないGUI／PDF受入、新規警告と既知警告を分ける。

## 判定原則

- test成功は実画面品質、OSダイアログ、WebView DOM、外部サービス連携の成功を意味しない。
- GUI、実画面smoke、自動入力、画面captureの可否は、常にルート`AGENTS.md`の当該PC方針を正本とし、このskillへ固定値を複製しない。
- test件数、所要時間、p50／p95、warningは今回の出力から取得し、過去文書の値を再利用しない。
- flaky testを無条件retryで成功扱いにしない。初回失敗と再実行結果を分け、時刻、乱数、network、process依存を調べる。
- 作業ツリーに無関係な変更がある場合、検証対象と結果への影響を明示する。ユーザー差分を修正、削除、stageしない。
- 要求を満たさない箇所は、ファイルと根拠を示して報告する。修正許可がないレビューでは変更を開始しない。

## 再現可能な検証入口

- `scripts/Invoke-Validate-MdVisualizer-all.ps1 -Version <対象版> -Target Static,Web,SPFx` を基本に、変更対象に合わせて選ぶ。Desktopを含める場合はTargetへ追加する。依存導入や直接buildを同時起動しない。
- `dev/history/<版>/logs/<RunId>/summary.json` と工程別ログを読む。失敗・未実行・件数不明を成功へ置き換えず、再実行は新RunIdで残す。lock残存時は所有処理を確認し、自動削除しない。
- 全UI対応表と `npm run check:ui-contract`、CSS分布、共有境界、要求ID検査を使う。対応表の静的合格から実寸・条件付き表示・実操作の成功を推測しない。
- 詳細は `docs/developer/operations/02-development-automation.md`。自動化変更では同資料の自己テストも実施する。
