# MdVisualizer 開発者ガイド

## 提供物と構成

本リポジトリは、Rust／TauriとReactで構成するWindowsデスクトップ版、SharePoint Framework版、両者が共有するMarkdown処理を管理します。

Web版のcanonicalは `web-platform` 子リポジトリです。親側の `web/`、`spfx/`、`packages/markdown-core/`、HTML export旧パスは `scripts/setup-web-platform.mjs` の互換リンクとして扱います。初回取得は `git clone --recurse-submodules`、既存環境の再接続は `node scripts/setup-web-platform.mjs` です。

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

共通UIの唯一の正本は `web-platform/packages/editor-ui/src/`（投影対象は`packages/editor-ui/source-map.json`で管理）です。投影先の手修正は避け、同期時のハッシュガードで検出します。Webの版番号は `web-platform/targets.json` で独立管理します。

プロジェクト固有ルールと資料を読む条件はルートの`AGENTS.md`を正本とします。

## 開発環境

- Node.js LTS、npm
- Rustup、Cargo、rustc
- Windows向けRustビルドに必要なVisual Studio Build Tools
- SPFxを扱う場合は、リポジトリが固定するNode.js／Heft環境

子リポジトリの依存導入と予定ビルドは `npm.cmd --prefix web-platform ci`、`npm.cmd --prefix web-platform run build:web`、`npm.cmd --prefix web-platform run build:spfx` です。

依存導入、ビルド、テストの再現可能な入口は[ビルド・検証コマンド](/docs/developer/BUILD_COMMANDS.md)にまとめています。PowerShellは`pwsh`を使用します。

## 実装境界

- Markdownの純粋変換は原則として`packages/markdown-core/`へ置き、デスクトップ版とSPFx版へ重複実装しません。
- UIは既存component、hook、state、adapterの境界を維持し、OSや保存処理へ直接依存させません。
- ファイル、設定、SharePoint保存は、文字コード、BOM、改行、revision／eTag、未保存draft、原子的置換を維持します。
- path、URL、SVG／HTML、外部process、資格情報に触れる変更では、正常系と失敗・攻撃系を併せて検証します。
- SPFx solution ID、component ID、Tauri command名、公開DTOは移行計画なしに変更しません。

本書を開発資料の入口とします。機能別の詳細は以下の資料から確認できます。設計上の提案と現行の製品契約を区別します。

## GUI受入

日常のfrontend修正は既存の`tauri dev`起動を維持し、HMRで確認します。機能単位の完了時にフルビルドとGUI受入を行い、公開指示後はproduction成果物を検証します。[起動・受入・リリースの手順](/docs/developer/BUILD_COMMANDS.md)と[性能回帰測定](/docs/developer/testing/06-performance-regression.md)を工程選択の入口にしてください。

実画面確認の可否、操作対象、未保存文書の保護は[AGENTS.md](../AGENTS.md)のGUIテスト方針を正本とします。確認手順は[検証手順](/docs/developer/testing/01-test-strategy.md)を参照し、実施結果と未確認事項は対象版の実装報告へ記録します。

## 配布との境界

通常のビルド・テストは署名、インストール、App Catalog変更、FTP公開を行いません。配布の正本は`dev/RELEASE_RULE.md`です。リリース作業はルート`AGENTS.md`の許可条件と対象の公開skillに従います。

## 開発資料の案内

- [製品概要・利用方法](/README.md)
- [AI相談・編集](/docs/user/ui/codex.md)、[AIスキル設定](/docs/user/ui/codex-skills.md)、[編集画面の状態](/docs/developer/ui/01-product-ux.md)
- [HTML出力CLI](/docs/user/HTML_EXPORT_CLI.md)。独立CLIの完成範囲を説明する。本体導入時の契約は[HTML出力統合仕様](/docs/developer/HTML_EXPORT_INTEGRATION.md)。
- [検証の入口](/docs/developer/testing/01-test-strategy.md)、[検証ケースの入口](/docs/developer/testing/02-test-cases.md)、[内部PDF](/docs/developer/testing/03-internal-pdf.md)、[Diff](/docs/developer/testing/04-document-diff.md)
- [品質運用](/docs/developer/operations/01-quality-operations.md)、[設計資料一覧](/docs/DEVELOPERS_GUIDE.md#設計資料一覧)

本書と各詳細資料で、仕組み・設計理由・制約・操作・検証方法を理解できる内容に保ちます。説明を別のREADMEや過去の実施記録へ委ねません。

## 設計資料一覧

以下の対象版・状態・依存は策定時の情報です。現在の実装状況とは区別し、未採用の案を現行仕様として扱いません。

| ID | 設計書 | 対象版 | 状態 | 主な依存 |
| --- | --- | --- | --- | --- |
| DES-01 | [アーキテクチャ分割](/docs/developer/design/01-architecture-foundation.md) | v0.0.14 | PROPOSED | v0.0.13受入完了 |
| DES-02 | [補助SQLiteデータストア](/docs/developer/design/02-local-data-store.md) | v0.0.14 | PROPOSED | DES-01 |
| DES-03 | [セキュリティ境界](/docs/developer/design/03-security-boundary.md) | v0.0.14 | PROPOSED | DES-01 |
| DES-04 | [内部プロバイダー基盤](/docs/developer/design/04-provider-architecture.md) | v0.0.14 | PROPOSED | DES-01〜03 |
| DES-05 | [SharePointバックグラウンド同期](/docs/developer/design/05-sharepoint-sync.md) | v0.0.15 | DEFERRED | DES-02〜04 |
| DES-06 | [AI実装支援](/docs/developer/design/06-ai-assistance.md) | v0.0.16 | DEFERRED | DES-03〜05 |

## 共通の設計方針

- Markdown構文処理はOS、React、SharePoint、AIから独立した純粋関数として扱う。
- 文書セッション・保存などのユースケースと、ファイル・通信・資格情報・プロセスなどの具体的I/Oを分ける。
- デスクトップとSPFxの環境差はアダプター境界に集約する。
- UIから外部I/Oの詳細を直接組み立てず、能力と結果を明示した契約を通す。
- 変更は責務ごとに分割し、保存・競合・キャンセルの契約を検証する。

## 導入・操作と環境構築

- [ボタンの外観・配置チェック](/docs/developer/testing/04-button-layout.md)：静的分布と補助の実寸監査
- [Webモバイルの操作台帳](/docs/developer/testing/05-web-mobile-commands.md)：折りたたみ後の全コマンドの到達経路と検証

- [Web版と共通編集・出力](/docs/developer/web/ARCHITECTURE.md)：単一HTML生成、共有GUI、資産・文字コード・検証
- [PHP版の運用](/docs/developer/web/PHP_OPERATIONS.md)：SSO、暗号化ZIP、非公開設定、期限管理

- [インストール手順](/docs/user/INSTALLATION.md)
- [利用ガイド](/docs/USERS_GUIDE.md)：対応機能、編集、検索、印刷、SharePoint、ショートカット、データ保護
- [開発環境のセットアップ](/docs/developer/DEVELOPMENT_SETUP.md)：初回起動、MSIX作成、署名環境

## 表・表示切替の共通実装

`WorkspaceViewControls`、`DelimitedTableBlock`、`DocumentDiffWorkspace`は共有正本です。SPFxは`spfx*Bridge.tsx`と`build-embedded-tools.mjs`からReact UIとCSSを生成し、WebPartがSharePointの認証・保存・eTagを所有します。生成ファイルは直接変更しません。コードのFile貼付とドロップは`onResolveFileAttachment` adapterでホストの保存モデルへ接続します。

回帰サンプルは子Gitの`tests/fixtures/v0.0.18-ui-cases.json`、要求ID別の受入は版別test-requirementsへ記録します。表の空行・空ヘッダ・ヘッダOFF・文字コード・CRLFを保存契約として検証します。更新番号を未保存バッジの根拠にせず、ステージされた未保存資産の存在を用います。

設定案内の同梱スキルは共有`features/codex/default-skills/app-settings/SKILL.md`です。デスクトップでは既存ユーザーへの一回限りの追加を行い、削除後に再配布しません。

- [開発・検証・Web公開の自動化](/docs/developer/operations/02-development-automation.md)、[全UI機能対応表](/docs/developer/ui/UI_COMMAND_MATRIX.md)

## ブロック・埋め込みファイルのメニュー変更

コードブロック、Mermaid、SVG、draw.io、表、埋め込み／外部参照ファイルのメニュー変更では、最初に[共通メニュー仕様](/docs/developer/ui/BLOCK_UI_SPEC.md)と同書の定義表・最終配置順を参照する。形式ごとに独自の並び順を増やさず、共通ID・表示条件・幅別配置を更新して実装と照合する。

- [Desktop/Webの画面配置](/docs/developer/ui/WORKSPACE_LAYOUT.md)：メイン、プレビュー上部・左端、フッターの役割と順序。

- 日常の高速検証・増分型検査・関連テスト・性能計測は [開発・検証の自動化](/docs/developer/operations/02-development-automation.md) の「高速検証」を参照する。全件検証と公開時の実確認は省略しない。

- [画像注釈HTMLの統合](/docs/developer/ui/SCREENPRESSO_INTEGRATION.md)：Screenpresso画面の隔離・保存契約と新旧共存の検証。
