# 変更領域と契約

変更の配置先と、同時に確認すべき境界を決めるために使う。

| 変更内容 | 主な配置先 | 同時に確認するもの |
| --- | --- | --- |
| Markdown構文、見出し、list、table、source位置などの純粋変換 | `packages/markdown-core` | `src/`と`spfx/`のconsumer、core build、両製品の回帰 |
| デスクトップの表示、編集、focus、状態 | `src/components`、`src/hooks`、`src/lib`、`src/state` | Testing Library、keyboard、draft、非active tab、production build |
| ファイル、画像、watch、設定、資格情報、OS連携 | `src-tauri/src` | Tauri command DTO、Rust test、frontend bridge、pathとsecret境界 |
| SharePointデスクトップ | `src/lib/sharePoint*`、Rust SharePoint処理 | host／site制限、token送信先、encoding、eTag、412時draft保持 |
| SPFx固有UI・保存 | `spfx/src` | 共有core互換、Heft test/build、mobile幅、SharePoint権限 |
| CSS、印刷、レスポンシブ | `src/styles`と該当component | style契約test、印刷専用状態、200% text、light／dark、目視残件 |
| 起動・検証スクリプト | `scripts`と`package.json` | `pwsh`、`-WhatIf`、命名test、状態API、公開処理との分離 |
| 配布・署名・公開 | `packaging`と公開script | このskillの対象外。MSIXまたはSPFx公開skillへ切り替える |

## 守るべき横断契約

- 本文の正本はMarkdown／SharePointファイルであり、補助状態へ本文やsecretを安易に複製しない。
- 保存不能、外部更新、412、部分失敗で元ファイルを上書きせず、利用者のdraftを保持する。
- encoding、BOM、改行、末尾改行、相対参照、alt、図表の外部／埋込表現を意図せず変えない。
- source位置を扱う機能は検索、目次、診断、編集、Diff、navigation historyの整合を確認する。
- DOMで扱える純粋処理と、Tauri／SharePoint／process依存を分離し、テスト可能な境界を保つ。
- 既存公開DTO、Tauri command名、SPFx solution／component IDは移行計画なしに一括変更しない。

## 代表的な変更波及

- Markdownレンダリング変更: sanitizer、code、表、画像、図表、印刷、SPFxまで確認する。
- 編集操作変更: selection、Undo／Redo、source置換、即時保存、Diff、外部CSV／TSVを確認する。
- path処理変更: Windows大小文字、Unicode、相対／絶対、SharePoint URI、traversal、symlink／junctionを確認する。
- タブ・window変更: active状態、複数window、secondary launch、session復元、未保存表示を確認する。
- 印刷変更: snapshotと冪等復元、timeout／例外／取消、通常／presentation／tableを確認する。
