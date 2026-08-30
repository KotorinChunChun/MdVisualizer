# 設計書一覧

作成日: 2026-08-30

| ID | 設計書 | 対象版 | 状態 | 主な依存 |
| --- | --- | --- | --- | --- |
| DES-01 | [アーキテクチャ分割](01-architecture-foundation.md) | v0.0.14 | PROPOSED | v0.0.13受入完了 |
| DES-02 | [補助SQLiteデータストア](02-local-data-store.md) | v0.0.14 | PROPOSED | DES-01 |
| DES-03 | [セキュリティ境界](03-security-boundary.md) | v0.0.14 | PROPOSED | DES-01 |
| DES-04 | [内部プロバイダー基盤](04-provider-architecture.md) | v0.0.14 | PROPOSED | DES-01〜03 |
| DES-05 | [SharePointバックグラウンド同期](05-sharepoint-sync.md) | v0.0.15 | DEFERRED | DES-02〜04 |
| DES-06 | [AI実装支援](06-ai-assistance.md) | v0.0.16 | DEFERRED | DES-03〜05 |

各設計書は、背景、目的、機能概要、ユースケース、画面遷移、処理フロー、データ構造、API、エラー処理、テスト、完了条件、将来拡張を含む。実装着手時は一設計をさらに3〜10人日程度のタスクへ分割し、一つのAIタスクが複数の責務境界をまたがないようにする。

## 共通ルール

- `packages/markdown-core`: Markdown構文の純粋関数。OS、React、SharePoint、AIへ依存しない。
- `packages/application-core`: 文書セッション、保存、同期、AI提案の型とユースケース。具体的I/Oへ依存しない。
- `src/adapters`: デスクトップReactからTauriへ接続する実装。
- `spfx/src/.../adapters`: SPFxからSharePointへ接続する実装。
- `src-tauri/src`: ファイル、資格情報、プロセス、HTTP、SQLiteなどWindows側の境界。
- UIはユースケースを呼び、Tauri command名やSharePoint REST URLを直接組み立てない。
