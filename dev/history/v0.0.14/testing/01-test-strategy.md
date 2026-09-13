# MdVisualizer テスト計画

作成日: 2026-08-30
状態: PROPOSED

本書は今後の導入計画を含む。内部PDFテストは2026-08-31に実装済みだが、汎用Browser E2E、coverage、axe等の導入完了を意味しない。実施状況は対象版の`dev/history/vX.Y.Z/vX.Y.Z-task.md`を正とする。

## 1. 目的

「人手でしか確認できない仕様」を、描画品質とOS固有ダイアログの最終確認まで減らす。保存安全性、競合、同期、AI変更、セキュリティは失敗系を含めて自動判定し、手動確認をデータ損失防止の最後の補助に限定する。

## 2. テストレイヤー

| レイヤー | 対象 | ツール | 実行頻度 |
| --- | --- | --- | --- |
| Unit | 純粋変換、Reducer、state machine、validator | Vitest、Rust `cargo test`、SPFx Jest | 変更ごと |
| Component | React/SPFx UI、キーボード、focus、ARIA | Testing Library、Vitest/Jest、axe | 変更ごと |
| Contract | Local/SharePoint/SPFx/Fake provider | 共通fixture＋Vitest/Jest/Rust | PRごと |
| Integration | Tauri境界、SQLite、Graph/AI mock、CLI process | Rust test、temp DB、mock transport | PRごと |
| Browser E2E | AppShell、保存、Diff、レスポンシブ、AI fake | Playwright＋ブラウザーハーネス | PRごと |
| Desktop E2E | 実WebView、Mermaid/draw.io、ファイル、印刷前状態 | 既存CDP smoke（専用runner） | 専用runner/beta前 |
| UI受入 | OS印刷、資格情報、MSIX、外部アプリ | 専用runnerまたは手動手順 | beta前 |
| 内部PDF | 通常／プレゼン／選択表の印刷内容・復元 | `npm.cmd run test:print-pdf`（headless Edge＋PDF.js） | 印刷変更時 |
| Security | XSS、SVG、path、redirect、secret、CLI | corpus test、dependency audit | PR/nightly |
| Performance | 起動、検索、描画、DB、同期、AI stream | benchmark script、Playwright trace | nightly/beta前 |

当該PCでは2026-09-13のユーザー指示によりDesktop E2EとUI受入を実施できる。操作範囲と未保存文書の保護は最新のAGENTS.mdに従う。内部PDFテストはGUIやOSプリンターを使わずに実行する。手順とCubePDFを使う手動受入との境界は[内部PDFによる印刷受入](../../../../docs/testing/03-internal-pdf.md)を参照する。

## 3. ツール選定

### 採用

- `Vitest`: デスクトップTypeScriptの既存資産を継続する。
- `Testing Library`: 実装詳細ではなくrole、label、keyboard操作を検証する。
- `Jest`: SPFx既存Heft構成だけで使用する。ルートへ重複導入しない。
- `Playwright`: Tauri I/OをFakeProviderへ差し替えたブラウザーハーネス、SPFxレスポンシブ、スクリーンショット差分に使用する。
- `@axe-core/playwright`または同等axe連携: 重大なアクセシビリティ違反を検出する。
- `@faker-js/faker`: 日本語名、Unicode、パス、表データをseed固定で生成する。
- `MSW`: API互換AI providerとブラウザーハーネスのHTTP状態を再現する。Rust Graph処理はRust側mock transportを使う。
- Rust `tempfile`＋`rusqlite`: ケースごとにSQLite test DBを生成する。
- `cargo llvm-cov`: RustカバレッジをWindows CIで収集する。

### 今回採用しない

- `Storybook`: UIカタログの価値はあるが、v0.0.14ではPlaywright用状態カタログrouteとComponent testで代替し、依存・二重設定を増やさない。
- `pytest`: Python本体コードがなく、Node/Rustで完結するため追加しない。
- ルート`Jest`: Vitestとの二重管理を避ける。

## 4. テストデータ生成

`tools/test-data`にseed付きCLIを作る。

```ts
export interface FixtureOptions {
  seed: number;
  lineCount: number;
  headingCount: number;
  table?: { rows: number; columns: number; delimiter: "," | "\t" };
  diagrams?: { mermaid: number; drawio: number; invalid: number };
  references?: { valid: number; missing: number; traversal: number };
  encoding?: "utf8" | "utf8-bom" | "utf16le" | "shift-jis";
  lineEnding?: "lf" | "crlf" | "mixed";
}

export function generateFixture(options: FixtureOptions): GeneratedFixture;
```

生成物:

- Markdown本文と期待見出し・検索件数・診断件数
- PNG/SVG/draw.io/Mermaid/CSV/TSV fixture
- 正常、破損、巨大、危険HTML/SVG、path traversal fixture
- 旧版設定JSONと期待SQLite内容
- Graph/AI mock response sequence

乱数seedはtest IDから固定し、失敗時に同じ入力を再生成できるようにする。秘密・実tenant・実ユーザーパスは含めない。

## 5. カバレッジ目標

| 対象 | v0.0.14最低 | 中期目標 | 分岐最低 |
| --- | ---: | ---: | ---: |
| `packages/markdown-core` | 90% | 95% | 90% |
| `packages/application-core` | 90% | 95% | 90% |
| `src/lib`、Reducer、hooks | 85% | 90% | 80% |
| React components | 70% | 80% | 65% |
| Rust domain/validator/store | 85% | 90% | 80% |
| SPFx repository/controller | 80% | 85% | 75% |

全体率だけで低品質領域を隠さない。保存、競合、path、security、sync state、AI patchは行・分岐とも90%以上を必須とする。生成ケース数はカバレッジの代替にしない。

## 6. パフォーマンス基準

同一Windows release構成、warmup後10回以上でp50/p95を記録する。

| 指標 | 基準 |
| --- | ---: |
| 10,000行検索 | p95 200ms以下 |
| 10,000行初回本文表示 | p95 1,000ms以下 |
| タブ切替 | p95 100ms以下 |
| 設定DB読込 | p95 50ms以下 |
| 100タブsession保存 | p95 100ms以下 |
| 1,000行表の編集反映 | p95 150ms以下 |
| 主要入力のlong task | 50ms未満を原則とする |
| 通常起動 | p50 300ms以下を維持、測定定義を固定 |
| 初期安定時working set | 100MB以下を目標、図表未描画時 |

CIではrunner差を考慮して絶対失敗閾値を基準の2倍にし、基準超過は専用性能runnerで再確認する。

## 7. セキュリティ基準

- Critical/Highの既知依存脆弱性0。例外は影響評価、期限、回避策を記録する。
- XSS、外部SVG参照、javascript URL、path traversal、symlink/junction逸脱、SSRF、secret logを自動testする。
- SharePoint/AI Authorizationは許可host以外とredirect先へ送らない。
- AI CLIはshellを使わず、一時workspace外を変更できない。
- APIキー、refresh token、Markdown本文、AI promptがSQLite・ログ・DOM属性へ残らない。
- 保存・同期・AI patchはrevision guardを回避できない。

## 8. UI品質基準

- WCAG 2.2 AA相当。通常文字4.5:1、大文字・UI部品3:1以上。
- 主要操作はkeyboardだけで完結し、focusが見え、modal終了後に起点へ戻る。
- 320、390、768、1024、1440pxで重なり・切れ・横方向のページoverflowがない。
- light/dark、高コントラスト、200% text zoom、`prefers-reduced-motion`で利用可能。
- pointer targetはモバイル約44px、desktopは密度を保ちつつfocus領域を確保する。
- loading、offline、conflict、permission、empty、partial failureを色だけに頼らず示す。

## 9. CIゲート

### Pull Request

1. format/lint/typecheck
2. affected Unit/Component/contract
3. frontend production build
4. Rust test
5. SPFx test/build（共有core/SPFx変更時は必須）
6. coverage差分
7. Playwright smoke＋axe
8. secret/dependency scan

### Nightly

- 全4,000件超生成case
- 全Rust/SPFx
- 性能benchmark
- security corpus
- SQLite migration全fixture
- Graph/AI/CLI fault injection

### Beta前

- 規定Desktop smoke
- Microsoft Print to PDF
- MSIX/App Installer/SPFx成果物検証
- 署名、hash、MIME、Content-Length、download一致

## 10. 不安定テスト方針

- 自動retryで隠さない。初回結果とretry結果を別記録する。
- 2回以上不安定になったtestはownerと修正期限を付けて隔離し、データ損失・security testは隔離禁止。
- 時刻、乱数、network、processはfake clock/seed/mockで決定的にする。

## 11. 完了条件

- [テストケース](../../../../docs/testing/02-test-cases.md)のP0ケースが自動化される。
- coverage、性能、security、UI品質の数値がCI artifactとして参照できる。
- 手動確認項目に、自動化できない技術的理由と証跡保存方法がある。
- desktop/SPFxの能力差が同一contract testと能力マトリクスで説明できる。

## v0.0.15 Codex通信ログの例外

ユーザー要求による任意Codex CLI連携では、成功した送信プロンプト（対象本文・会話を含む）、応答、JSONLをアプリのローカル領域のcodex-log.jsonへ保存する。既定20件、1〜1,000件で設定する。一般診断ログや将来のSQLite履歴への本文非記録方針とは区別する。アプリは認証情報をログ項目として取得しないが、利用者が本文に含めた情報はそのまま記録される。検証では件数制限・原子的保存・受信表示を確認する。

## 現行の検証手順の入口（0.0.17完了時に統合）

この節は運用中の確認手順とする。上記の導入計画をすべて実装済みとは扱わない。実行コマンドは[ビルド・検証コマンド](../../../../docs/BUILD_COMMANDS.md)、差分の詳細は[Diffの検証](../../../../docs/testing/04-document-diff.md)、ケース一覧は[テストケース設計](../../../../docs/testing/02-test-cases.md)を参照する。版別要求書に同じ手順を複製しない。

### 回帰確認

1. 閲覧のみでレンダリング差分を確認する。3-wayの基準・ストレージ・採用結果の列と可変境界を確認し、図のコードを壊してエラー表示、修復後の即時復旧を確認する。
2. AI履歴の保存失敗後、再保存成功・問題添付の除去・保存対象消滅で警告が解除されることを確認する。同じ図から新規会話を再開し、非同期処理中の会話切替で別会話へ添付されないこと、送信成功後だけ対象が解除されることを確認する。
3. 保存・再読込前後のスクロールと折畳、H1除外、選択テキストの取り込み、Markdown／プレーンコピー、ALT直接編集とUndoを確認する。
4. 差分・会話の状態遷移は正常・異常・境界の回帰テストで確認する。ラベルやソースの文字列一致だけで実動作を保証しない。変更範囲に必要な自動検証と実画面確認を選び、実施範囲と未実施を記録する。

### 静的検査と資料点検

- ボタン共通化は既存の npm.cmd run test:button-style-rules を使う。npm.cmd test のpretestにも組み込まれているため重複実装しない。外観・状態の実画面確認は別に扱う。
- Markdownローカルリンクをリンク元から解決し、移動後の参照先を確認する。版・ブランチ表記は現在のGit参照と照合し、過去の公開記録は当時の表記として区別する。
- AIメニューはテキスト・コード・PNG・Mermaid・draw.io・SVGの対象とスキル設定を照合する。項目の有無に加え、選択取り込み・新規会話・現在の会話への追加を回帰テストで確認する。
- 版完了時は資料移動、リンク更新、完了・保留の分類を確認する。スキルへ反映する場合は既存develop／verify／releaseスキルへの統合を優先する。
