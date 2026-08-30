# MarkdownViewer 長期開発計画

作成日: 2026-08-30
対象基準: `feature/v0.0.13` / アプリ版 `0.0.13`

本ディレクトリは、既存要求・実装報告・ソース・テスト・配布運用の監査結果と、ユーザー確認済みの製品方針を基にした長期計画である。各文書は単独で読めるようにし、詳細設計を一つの巨大文書へ集約しない。

## 指定された出力順

1. [現状分析](roadmap/01-current-state.md)
2. [ロードマップ](roadmap/02-product-roadmap.md)
3. [要確認事項と確定判断](roadmap/03-decisions.md)
4. [設計書一覧](design/README.md)
5. 各設計書
   - [v0.0.14 アーキテクチャ分割](design/01-architecture-foundation.md)
   - [補助SQLiteデータストア](design/02-local-data-store.md)
   - [セキュリティ境界](design/03-security-boundary.md)
   - [内部プロバイダー基盤](design/04-provider-architecture.md)
   - [SharePointバックグラウンド同期](design/05-sharepoint-sync.md)
   - [AI実装支援](design/06-ai-assistance.md)
6. [全体タスクリスト](tasks/01-roadmap-tasks.md)
7. [テスト計画](testing/01-test-strategy.md) / [テストケース](testing/02-test-cases.md)
8. [GUI/UX提案](ui/01-product-ux.md)
9. [想定リスク](roadmap/04-risk-register.md)
10. [次に実装すべき内容](roadmap/05-next-release.md)

運用・品質ゲートは[CI・リリース・セキュリティ運用](operations/01-quality-operations.md)にまとめる。版単位の実装計画と進捗は`dev/v0.0.14-imp.md`および`dev/v0.0.14-task.md`を正本とする。

## 文書の状態

- `APPROVED`: ウィザード回答で確定した製品方針
- `PROPOSED`: 実装前レビュー対象の設計案
- `DEFERRED`: 後続版まで実装しない設計
- `SUPERSEDED`: 後続判断で置き換えられた過去方針

現時点では製品方針が`APPROVED`、技術設計は`PROPOSED`である。コード実装開始時に各設計のDefinition of Readyを満たしていることを確認する。
