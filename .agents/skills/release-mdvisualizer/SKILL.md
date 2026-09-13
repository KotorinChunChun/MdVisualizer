---
name: release-mdvisualizer
description: MdVisualizerのproduction検証、SPFx sppkg、ポータブルZIP、署名済みMSIX・App Installer、配布サイト更新、公開後検証を統合する。MdVisualizerのリリース、beta公開、成果物アップロードで使用し、相談・計画だけの依頼は読み取り専用に保つ。
---

# MdVisualizerを公開する

複数の成果物と公開先を一つの製品リリースとして扱いながら、各公開段階の成否を分離して記録する。

## 依頼を分類する

- 相談、レビュー、計画、状況確認では読み取りだけを行う。
- ルート`AGENTS.md`に定義された「リリースしてください。」は、beta版のproduction検証、全成果物生成、既存公開先へのアップロード、公開後検証までを明示したものとして扱う。
- build、sppkgアップロード、App Catalog展開、MSIX公開、Website更新、installは独立した操作である。上記のプロジェクト固有省略指示または個別の明示がない限り、狭い範囲だけを実行する。
- stableは、ユーザーがstable方針への変更またはstableリリースを明示した場合だけ扱う。

## 事前確認

1. ルート`AGENTS.md`、対象版の`req／imp／task`、Git状態、既存リリース報告を読む。
2. `scripts/README.md`、`package.json`、`scripts/build-release-MdVisualizer-spfx.ps1`、`scripts/publish-release-MdVisualizer-spfx.ps1`、`upload-sppkg.ps1`、`packaging/release-config.json`、`scripts/publish-release-MdVisualizer-all.ps1`を確認する。
3. アプリ、SPFx、Websiteの各リポジトリにあるユーザー差分を分離し、対象パスだけをコミットする。
4. 版、beta公開先、App Catalog scope、MSIX identity、署名証明書、ポータブルZIP生成経路を解決する。
5. [references/release-matrix.md](references/release-matrix.md)を読み、成果物ごとの生成・公開・検証経路を確定する。

必要な成果物のガード付き生成経路がない場合、即席コマンドで公開を続行しない。未整備の自動化と安全な次手を報告し、実装許可がある場合だけ公開スクリプトを整備する。

## フェーズ

1. `Plan`相当の読み取り確認で、対象版、成果物、公開先、現在版、必要権限を提示する。
2. productionテスト、共有core、frontend、Rust、SPFxのローカルbuildを実行する。
3. sppkg、ポータブルZIP、MSIX、App Installerを個別に生成・検証する。
4. sppkgを既存サイトコレクションApp Catalogへ上書きアップロードして検証する。全サイト展開は明示された場合だけ行う。
5. ZIP、MSIX、App Installer、CER、配布記事をbeta公開先へステージし、Website対象差分だけをコミットする。
6. 明示された既存公開先へアップロードし、HTTP、MIME、Content-Length、表示版、リンク、取得物ハッシュ、App Catalog状態を確認する。
7. `dev/history/vX.Y.Z/vX.Y.Z-imp.md`とtaskへ、版、署名、ハッシュ、公開先、各段階の成否、未実施GUI受入、コミットを記録する。

PowerShellは必ず`pwsh`で実行する。秘密値、PFX、token、FTP資格情報を表示・記録しない。ローカル生成だけで製品リリース完了としない。
