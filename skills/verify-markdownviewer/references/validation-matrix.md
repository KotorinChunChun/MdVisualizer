# 検証マトリクス

すべてルート`C:\develop\MarkdownViewer`から実行する。PowerShell scriptは必ず`pwsh`を使う。依存導入、公開、installは別の許可を必要とする。

## 変更領域ごとの最小セット

| 変更領域 | 最初の検証 | 横断確認 |
| --- | --- | --- |
| `src/lib`の純粋処理 | 該当`*.test.ts` | consumer component、`npm.cmd run build` |
| React component／hook／state | 該当`*.test.tsx`と関連lib test | keyboard／focus／draftの回帰、`npm.cmd run build` |
| `packages/markdown-core` | `npm.cmd run build:core` | frontend全体、SPFx test／production build |
| `src-tauri` | 対象module testまたは`cargo test --manifest-path .\src-tauri\Cargo.toml` | command DTOのfrontend test、必要時desktop build |
| `spfx` | `npm.cmd --prefix .\spfx test` | `npm.cmd run build:core`、`npm.cmd run build:spfx:local` |
| style／responsive／print | 該当style・component・print test | production build。目視、PDF、実WebViewは別証跡 |
| 起動script／package script | `npm.cmd run test:run-scripts` | `-WhatIf`対応、公開系なら`npm.cmd run release:test-safety` |
| 保存／競合／path／security | 正常fixtureと失敗・攻撃fixture | frontendとRust境界、元データ不変、secret非露出 |
| 性能 | 影響するperformance testをseed固定で実行 | warmup条件、反復数、p50／p95、環境を記録 |

targeted Vitestは既存のnpm scriptを通す。

```powershell
npm.cmd test -- <対象testファイル...>
```

## 統合ゲート

変更範囲に応じて次を追加する。単なるレビューでは勝手に実行せず、検証を明示された場合に使う。

```powershell
npm.cmd test
npm.cmd run build
cargo test --manifest-path .\src-tauri\Cargo.toml
npm.cmd --prefix .\spfx test
npm.cmd run build:spfx:local
```

- `npm.cmd run build`は共有core、TypeScript型検査、Vite production buildを含む。
- `build:spfx:local`は`-SkipUpload`経路を使う。SPFx uploadを検証コマンドの一部にしない。
- `npm.cmd run tauri build`は重いdesktop成果物生成である。要求や受入条件に含まれる場合だけ追加し、MSIX生成とは分ける。
- GUIを行わない当該PCでは`npm.cmd run debug:smoke`を実行しない。状態API、WebView、PDF、画面captureが必要な項目は専用runnerへ残す。

## 不具合別の追加観点

- Markdown表示: sanitizer、source位置、code、表、画像、図表、印刷、SPFx。
- 編集: selection、Undo／Redo、改行、即時保存、Diff、外部更新競合。
- 図表: source／alt／拡張子、埋込・外部表現、失敗fallback、SVG安全性。
- 表: GFM／CSV／TSV、quote、貼付、sort／filter／aggregate、Undo、印刷。
- navigation: 折畳、検索世代、目次、履歴、複数window／tab。
- 印刷: 成功、timeout、例外、取消後の冪等復元とsnapshot。
- SharePoint: 401／403／404／412／429、eTag、別host redirect、Authorization送信先。
