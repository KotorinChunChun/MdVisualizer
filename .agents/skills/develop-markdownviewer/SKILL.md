---
name: develop-markdownviewer
description: MarkdownViewerの機能追加、不具合修正、リファクタリングを、版管理文書、React／Tauri／共有core／SPFxの境界、保存安全性、段階検証に沿って実装する。実装を伴う依頼で使用し、相談・計画だけの依頼やリリース作業には使用しない。
---

# MarkdownViewerを実装する

要求を既存の製品契約へ接続し、対象差分だけを段階的に実装・検証・記録する。

## 着手前

1. ルートの`AGENTS.md`と、対象版の`dev/vX.Y.Z-{req,imp,task}.md`を読む。ロードマップ文書がある場合も、要求・実装報告・進捗の正本はこの3系統とする。
2. `git status --short`と対象コードの既存テストを確認し、ユーザーの未コミット差分を分離する。要求文書はユーザーの記録として扱い、明示依頼なしに書き換えない。
3. 変更領域を決める際は[変更領域と契約](references/change-routing.md)を読む。複数ランタイムにまたがる場合は、共有契約から先に固定する。
4. 実装量が多い場合は、1フェーズ1責務の小さな単位へ分ける。各単位に対象ファイル、維持する契約、対象テスト、完了条件を持たせる。

## 実装

- 保存、競合、文字コード、改行、revision／eTag、draft保持、原子的置換をユーザー資産保護の契約として扱う。失敗系を成功系と同じフェーズでテストする。
- Markdown変換や構文解釈をデスクトップとSPFxで共有すべき場合は`packages/markdown-core`へ置き、片方のUIだけへ同じ変換を複製しない。
- UIからOS、SharePoint、保存処理へ直接依存を増やす前に、既存adapter、hook、Tauri command、repository境界を探す。
- 巨大な`src/App.tsx`や`src-tauri/src/commands.rs`を全面書換えしない。既存DTOとeventを保った小さな抽出、adapter追加、呼出し元移行の順で進める。
- path、URL、SVG／HTML、外部process、資格情報に触れる変更では、許可範囲、redirect、sanitization、secret非露出の正常・攻撃fixtureを対で追加する。
- 操作UIはpointerだけで完了させず、keyboard、focus復帰、狭幅、light／darkの既存契約を確認する。

## フェーズを閉じる

1. 変更箇所に最も近いテストを先に実行し、境界をまたぐ場合は`verify-markdownviewer`の検証マトリクスで範囲を広げる。
2. 当該PCのGUI方針は常に最新の`AGENTS.md`を正とする。実施できない実画面受入を自動テスト成功で代替したことにしない。
3. `dev/vX.Y.Z-imp.md`へ実装内容、検証結果、既知制約を記録し、既存の`task.md`があればチェック状態を更新する。件数や性能値は実行結果だけを記録する。
4. 生成物、依存物、ユーザーのサンプル変更を混ぜず、対象差分だけを日本語コミットメッセージでコミットする。テスト失敗や残件があれば、完了扱いにせず記録する。

リリース、署名、App Catalog、FTP公開は実装完了の延長として実行せず、対応する公開skillとユーザーの明示的な許可へ切り替える。
