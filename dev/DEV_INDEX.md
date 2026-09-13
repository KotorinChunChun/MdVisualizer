# MdVisualizer 開発資料目録

dev/は、開発者本人の要求、計画、判断、作業記録を管理します。恒久的な仕様・設計知識・操作・検証手順は[docs](/docs/DEVELOPERS_GUIDE.md)、配置規則は[AGENTS.md](/AGENTS.md)を正本とします。

## 版別の開発資料

- 過去・進行中・予定のすべての版別資料は、最初からdev/history/vX.Y.Z/内に作成します。複数版の資料はhistory内の版別フォルダーに共存します。
- 要求はvX.Y.Z-req.md、実装計画・実施報告はvX.Y.Z-imp.mdへ記録します。要求が粗い場合や複数フェーズを管理する場合はvX.Y.Z-task.mdを使用します。
- 次版へ進むときは新しい版フォルダーを作ります。完了後にdev直下から移す運用にはしません。
- 要求、判断、進捗、実施結果、未確認事項を確認するときは、[history](history/)の該当版の実資料を参照します。版番号だけで完了と判断しません。
- 本目録には現在の対象版、進捗、完了状況を記載しません。history直下にも「現状」をまとめた別ファイルを作らず、版別の実資料で確認します。

## フォルダー構成と目的別配置

以下の配置はリポジトリルートを基準とします。

| 配置 | 内容 |
|---|---|
| dev/DEV_INDEX.md | 開発資料の所在と読み方を示す恒久的な目録 |
| dev/history/vX.Y.Z/ | その版の要求、計画、判断、実装報告、進捗、検証・リリース結果の要約。Git管理対象 |
| dev/history/vX.Y.Z/logs/ | 実行別の動画、生ログ、録画台帳、機械生成レポート。Git対象外 |
| dev/PLAN_IDEAS.md | 提案・保留案の見出しと概要。関連する調査資料・試作品への入口 |
| dev/PLAN_REJECT.md | 不採用の判断と理由 |
| dev/research/ | 対象別の調査・比較資料、試作品。ログ用フォルダーは設けない |
| dev/scripts/ | 性能測定など開発記録に密接な補助スクリプト |
| dev/RELEASE_RULE.md | プロジェクト固有の配布・公開手順 |
| dev/private/ | 秘密情報・個人情報を含む非公開資料。Git、公開、通常検索の対象外 |
| dev/temp/ | 一時制作物。Git、公開、資料目録、通常検索の対象外 |
| docs/ | 恒久的な仕様、採用した設計と理由、開発・操作・検証手順 |
| scripts/ | npm、MSIX、SPFxなどから使う再現可能な運用スクリプト |
| samples/・tests/ | 製品の回帰サンプル、試験入力、期待結果 |
| release/ | 再生成可能な配布成果物。Git対象外 |

private/とtemp/はユーザーが対象を明示した場合だけ読みます。秘密値は実装報告、テスト出力、コミットへ転載しません。

提案・保留案は[PLAN_IDEAS.md](PLAN_IDEAS.md)へ、不採用判断は[PLAN_REJECT.md](PLAN_REJECT.md)へ記録します。試作品や調査資料を作った場合はPLAN_IDEAS.mdの該当項目から参照します。

## 開発に使う資料

- 開発構成と実装境界: [開発者ガイド](/docs/DEVELOPERS_GUIDE.md)
- 仕組み・設計理由・制約: [設計資料](/docs/DEVELOPERS_GUIDE.md#設計資料一覧)
- ビルド・検証コマンド: [ビルド手順](/docs/developer/BUILD_COMMANDS.md)
- 品質運用: [品質運用](/docs/developer/operations/01-quality-operations.md)
- 検証方法: [検証手順](/docs/developer/testing/01-test-strategy.md)
- 配布: [リリース手順](RELEASE_RULE.md)
- 版ごとの要求・計画・実施結果: [history](history/)

開発方法やノウハウはdocsだけで理解できる内容に保ち、時点ごとの作業記録とは分けます。過去の旧製品名、判断、未確認事項は当時の記録として保持します。

## 特殊なデバッグ補助

dev/scripts/replace-MdVisualizer-installed-msix-executable.ps1は、開発PCで登録済みMSIX内のexeだけを差し替える特殊なデバッグ補助です。署名整合性を壊すため通常のbuild、run、publishには含めません。旧release-MdVisualizer.ps1は互換転送だけを行い、安全契約はtest-MdVisualizer-installed-msix-executable-replacement.ps1で検証します。
