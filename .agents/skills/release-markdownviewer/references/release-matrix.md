# MarkdownViewerリリースマトリクス

実行時はリポジトリの現行スクリプトと設定を正とし、表の経路が存在することを確認する。

| 対象 | ローカル生成・確認 | 外部変更 | 完了証跡 |
| --- | --- | --- | --- |
| 共通core・frontend・Rust | 対象版のproduction test/build | なし | test数、build結果、警告 |
| SPFx | `scripts/build-release-MarkdownViewer-spfx.ps1`、sppkg manifest確認 | `scripts/publish-release-MarkdownViewer-spfx.ps1 -PublishConfirmed`で既存site collection App Catalogへ上書き | ProductId、Version、hash、Enabled、Valid、Deployed状態 |
| ポータブルZIP | ガード付き収集・ZIP生成、内容検査 | 既存beta配布先へupload | ファイル名、size、SHA-256、公開後hash |
| MSIX・App Installer・CER | `scripts/publish-release-MarkdownViewer-all.ps1`のBuild/Stage/Verify経路 | Publish/Full経路 | identity、Package Version、signer、URI、MIME、公開後hash |
| Website | 表示版、公開日、betaリンク、版付き直接リンクをstage | Website対象差分commitと既存FTP upload | HTTP、Content-Type、Content-Length、画面表示 |

## 重要な境界

- `scripts/publish-release-MarkdownViewer-all.ps1`はMSIX系のガード付きエントリーポイントであり、SPFxやポータブルZIPの成功を含むとはみなさない。
- sppkgのアップロードと展開は別結果として扱う。「アップロードするところまで」は全サイト展開を含めない。
- Website commit、FTP upload、App Catalog操作が部分成功した場合、成功済み状態を消さず、残りと復旧手順を記録する。
- 実機install、upgrade、uninstall、GUI受入は自動的に含めず、実施していなければ残件とする。
