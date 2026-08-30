# DES-01 v0.0.14 アーキテクチャ分割設計

作成日: 2026-08-30
状態: PROPOSED
対象版: v0.0.14

## 背景

`src/App.tsx`は文書読込、タブ、保存、競合、印刷、検索、診断、履歴、画像・図表編集、外部操作、各種モーダルを2,583行で管理する。`src-tauri/src/commands.rs`も文書、診断、監視、画像、外部プロセスを2,289行で扱う。同期とAIをこの構造へ直接追加すると、変更範囲、テスト時間、権限監査、AI実装時のコンテキスト量が増大する。

## 目的

- UI、アプリケーションユースケース、外部I/Oを分離する。
- デスクトップとSPFxが同じドメイン型・保存結果・エラー語彙を使う。
- 一つの実装タスクを原則1責務、3〜10ファイルに限定する。
- 現行機能と保存形式を変更せず段階移行する。

## 機能概要

1. `packages/application-core`を新設し、文書セッションと保存ユースケースを定義する。
2. `App.tsx`をAppShell、DocumentWorkspace、DocumentSessionController、NavigationControllerへ分割する。
3. Tauri呼出しを`src/adapters`へ集約する。
4. Rust commandを責務別モジュールへ移し、`lib.rs`は登録だけを行う。
5. デスクトップ／SPFx能力マトリクスを型で表現する。

## ユースケース

### UC-A01 文書を開く

利用者がローカルファイル、`spmd:` URI、SPFxファイル選択から文書を開く。UIは`OpenDocument`ユースケースだけを呼び、取得元の違いを意識しない。

### UC-A02 競合保護付きで保存する

編集中スナップショットのrevision/eTagを渡し、保存成功、競合、権限不足を共通結果で処理する。

### UC-A03 能力に応じて操作を表示する

ローカル文書では外部エディター、SPFxではSharePoint導線、モバイルでは簡易編集だけを表示する。存在しない能力を押して失敗させない。

## 画面遷移

```mermaid
flowchart LR
  Start[起動] --> Shell[AppShell]
  Shell --> Empty[開始画面]
  Empty --> Workspace[DocumentWorkspace]
  Workspace --> Preview[閲覧]
  Workspace --> Edit[編集]
  Workspace --> Split[編集・閲覧]
  Edit --> Conflict[競合Diff]
  Conflict --> Edit
  Workspace --> Settings[設定]
```

画面構成は変えず、状態所有者だけを分割する。タブバーとステータスバーはAppShell、文書固有モーダルはDocumentWorkspaceが所有する。

## 処理フロー

```mermaid
sequenceDiagram
  participant UI as DocumentWorkspace
  participant UC as SaveDocumentUseCase
  participant Repo as DocumentRepository
  participant Store as Local/SharePoint
  UI->>UC: execute(session, draft)
  UC->>Repo: save(request)
  Repo->>Store: revision付き保存
  alt 保存成功
    Store-->>Repo: 新snapshot
    Repo-->>UC: saved
    UC-->>UI: session更新
  else 競合
    Store-->>Repo: 最新snapshot
    Repo-->>UC: conflict
    UC-->>UI: Diff表示
  end
```

## データ構造

```ts
export type DocumentSource =
  | { kind: "local"; path: string }
  | { kind: "sharepoint"; uri: string };

export interface DocumentSnapshot {
  source: DocumentSource;
  content: string;
  revision: string;
  format: { encoding: string; lineEnding: "lf" | "crlf" | "cr"; bom: boolean };
  modifiedAt: string;
}

export interface DocumentSession {
  id: string;
  snapshot: DocumentSnapshot;
  draft: string;
  dirty: boolean;
  mode: "edit" | "split" | "preview";
  pendingAssetIds: string[];
}

export interface PlatformCapabilities {
  edit: boolean;
  externalEditor: boolean;
  backgroundSync: boolean;
  cliAi: boolean;
  imageWrite: boolean;
}
```

`DocumentSnapshot`は既存`MarkdownLoadResult`を置換せず、アダプター内で段階変換する。v0.0.14中に外部JSON契約は変更しない。

## API設計

```ts
export interface DocumentRepository {
  load(source: DocumentSource, signal?: AbortSignal): Promise<DocumentSnapshot>;
  save(request: {
    snapshot: DocumentSnapshot;
    content: string;
    pendingAssetIds: readonly string[];
  }): Promise<
    | { status: "saved"; snapshot: DocumentSnapshot }
    | { status: "conflict"; latest: DocumentSnapshot }
  >;
}
```

入力例:

```json
{"snapshot":{"source":{"kind":"local","path":"C:/docs/a.md"},"revision":"sha256:abc"},"content":"# 更新","pendingAssetIds":[]}
```

出力例:

```json
{"status":"saved","snapshot":{"source":{"kind":"local","path":"C:/docs/a.md"},"revision":"sha256:def","content":"# 更新"}}
```

### 対象ファイル

| 操作 | ファイル |
| --- | --- |
| 新規 | `packages/application-core/package.json`、`src/index.ts`、`src/document.ts`、`src/errors.ts`、`src/capabilities.ts` |
| 新規 | `src/app/AppShell.tsx`、`src/features/document/DocumentWorkspace.tsx`、`useDocumentSession.ts` |
| 新規 | `src/adapters/tauriDocumentRepository.ts` |
| 変更 | `src/App.tsx`（構成とイベント配線だけへ縮小） |
| 新規 | `src-tauri/src/commands/document.rs`、`diagnostics.rs`、`process.rs`、`watch.rs` |
| 変更 | `src-tauri/src/commands.rs`、`src-tauri/src/lib.rs` |

### 作成するクラス・関数

| 名前 | 引数 | 戻り値 | 責務 |
| --- | --- | --- | --- |
| `openDocument` | `repository, source, signal?` | `Promise<DocumentSession>` | 読込結果から初期セッションを作る |
| `saveDocument` | `repository, session` | `Promise<SaveDocumentResult>` | 保存と競合結果の正規化 |
| `toDocumentSnapshot` | `MarkdownLoadResult` | `DocumentSnapshot` | 既存Tauri DTO変換 |
| `capabilitiesFor` | `platform, source` | `PlatformCapabilities` | UI能力判定 |

## エラーハンドリング

```ts
export type AppFailure =
  | { code: "not_found"; message: string; retryable: false }
  | { code: "permission_denied"; message: string; retryable: false }
  | { code: "conflict"; message: string; retryable: false }
  | { code: "offline"; message: string; retryable: true }
  | { code: "cancelled"; message: string; retryable: false }
  | { code: "unexpected"; message: string; retryable: boolean; diagnosticId?: string };
```

UIは文字列解析をせず`code`で導線を選ぶ。Rust内部詳細、パス、トークン、HTTP本文は利用者向けmessageへ無制限に含めない。既存commandは当面文字列エラーを返すため、アダプターが既知エラーを変換し、未知値は`unexpected`とする。

## テスト方針

- Unit: `openDocument`、`saveDocument`、能力判定、DTO変換。
- Integration: fake repositoryで読込、保存、競合、キャンセルを通す。
- Component: AppShellとDocumentWorkspaceの状態所有境界を検証する。
- Contract: デスクトップとSPFxが同じfixtureから同じ`DocumentSnapshot`を返す。
- Regression: 既存テストを移動前後で維持し、削除は同等テスト移管後だけ行う。

## Definition of Ready

- v0.0.13未完了受入が分類済みである。
- 既存イベントと状態の所有者一覧が作成済みである。
- 1フェーズで移動する責務が一つに限定されている。
- 公開DTOを変更する場合は移行テストがある。

## 完了条件 / Definition of Done

- `App.tsx`を800行以下、`commands.rs`を登録・再公開中心の400行以下にする。
- 文書読込・保存・競合が`DocumentRepository`経由になる。
- デスクトップとSPFxの共通contract testが成功する。
- 全既存Unit、Component、Rust、SPFxテストとproduction buildが成功する。
- 実画面スモークで主要導線の回帰がない。
- 各新規公開関数にJSDocまたはRust doc commentと入出力例がある。

## 将来拡張案

- SharePoint同期、AI、Git、将来ストレージを同じprovider境界へ追加する。
- React UI部品の一部をWeb Componentsまたは共有headless modelへ移す。
- Windows以外を正式対応する場合もOS adapterを置換できるが、本ロードマップでは対象外とする。
