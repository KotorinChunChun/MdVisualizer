# MdVisualizer 開発者ガイド

## 提供物と構成

本リポジトリは、Rust／TauriとReactで構成するWindowsデスクトップ版、SharePoint Framework版、両者が共有するMarkdown処理を管理します。

| 配置 | 内容 |
|---|---|
| `src/` | デスクトップ版のReact UI、状態、frontend adapter |
| `src-tauri/` | ファイル、ウィンドウ、SharePoint、OS連携を担うRust backend |
| `packages/markdown-core/` | デスクトップ版とSPFx版の共有Markdown処理 |
| `spfx/` | SharePoint Framework版 |
| `tests/` | 製品横断の試験とfixtures |
| `scripts/` | npm、MSIX、SPFx、既存運用から参照される運用スクリプト |
| `dev/` | 版別要求、実装計画・報告、ロードマップ、開発記録 |
| `release/` | 再生成可能な配布成果物。Git対象外 |

プロジェクト固有ルールと資料を読む条件はルートの`AGENTS.md`を正本とします。実装前に対象版の`dev/vX.Y.Z-req.md`と対応する`imp.md`・`task.md`を確認してください。

## 開発環境

- Node.js LTS、npm
- Rustup、Cargo、rustc
- Windows向けRustビルドに必要なVisual Studio Build Tools
- SPFxを扱う場合は、リポジトリが固定するNode.js／Heft環境

依存導入、ビルド、テストの再現可能な入口は[ビルド・検証コマンド](BUILD_COMMANDS.md)にまとめています。PowerShellは`pwsh`を使用します。

## 実装境界

- Markdownの純粋変換は原則として`packages/markdown-core/`へ置き、デスクトップ版とSPFx版へ重複実装しません。
- UIは既存component、hook、state、adapterの境界を維持し、OSや保存処理へ直接依存させません。
- ファイル、設定、SharePoint保存は、文字コード、BOM、改行、revision／eTag、未保存draft、原子的置換を維持します。
- path、URL、SVG／HTML、外部process、資格情報に触れる変更では、正常系と失敗・攻撃系を併せて検証します。
- SPFx solution ID、component ID、Tauri command名、公開DTOは移行計画なしに変更しません。

公開可能な設計は`docs/design/`、品質運用は`docs/operations/`、検証手順は`docs/testing/`を参照してください。

## GUI受入

このPCではGUIテスト、自動マウス・キー入力、実画面smoke、画面captureを実施しません。状態API、WebView DOM、Mermaid／draw.io、PDF、実SharePoint等の実画面受入が必要な場合は、別PCまたは専用runnerの残件として記録します。

## 配布との境界

通常のビルド・テストは署名、インストール、App Catalog変更、FTP公開を行いません。配布の正本は`dev/RELEASE_RULE.md`です。リリース作業はルート`AGENTS.md`の許可条件と対象の公開skillに従います。
