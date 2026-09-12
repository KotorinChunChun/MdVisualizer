# MdVisualizer 開発資料目録

`dev/`は、開発者本人の計画、判断、作業記録を管理します。利用者および第三者開発者向けの説明は`README.md`と`docs/`を正本とします。

## 現行・予定版

- 要求は`vX.Y.Z-req.md`へ記録する。
- AIの実装計画と実施報告は`vX.Y.Z-imp.md`へ記録する。
- 要求が粗い場合や複数フェーズを管理する場合は`vX.Y.Z-task.md`を使用する。
- 現版、次版、次々版の資料は、必要な間は`dev/`直下に共存できる。
- 完成済み資料だけを`history/vX.Y.Z/`へ移す。版番号が進んだことだけを完了根拠にしない。

## 目的別配置

| 配置 | 内容 |
|---|---|
| `history/` | 完成済み版の要求、実装報告、進捗、リリース記録 |
| `roadmap/`または版別`roadmap`資料 | 将来計画、判断、不採用案、リスク |
| `scripts/` | 性能測定など、開発記録に密接な補助スクリプト |
| `private/` | 秘密情報・個人情報を含む非公開資料。Git、公開、通常検索の対象外 |
| `temp/` | プロジェクト外の一時制作物。Git、公開、資料目録、通常検索の対象外 |
| `RELEASE_RULE.md` | MdVisualizer固有の配布・公開手順 |

`private/`と`temp/`はユーザーが対象を明示した場合だけ読みます。秘密値は実装報告、テスト出力、コミットへ転載しません。

`dev/scripts/replace-MdVisualizer-installed-msix-executable.ps1`は、開発PCで登録済みMSIX内のexeだけを差し替える特殊なデバッグ補助です。署名整合性を壊すため通常のbuild、run、publishには含めません。旧`release-MdVisualizer.ps1`は互換転送だけを行い、安全契約は`test-MdVisualizer-installed-msix-executable-replacement.ps1`で検証します。

## 点検報告

- [GitHub公開前データ点検（2026-09-08）](publication-audit-2026-09-08.md)

## 関連する公開資料

- 開発構成と実装境界: `docs/DEVELOPERS_GUIDE.md`
- ビルド・検証: `docs/BUILD_COMMANDS.md`
- 品質運用: `docs/operations/01-quality-operations.md`
- 検証設計: `docs/testing/`
- 配布: `dev/RELEASE_RULE.md`
