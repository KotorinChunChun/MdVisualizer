# KotorinToysコレクション連携

2026-10-25。親の依頼に基づくv0.0.19の追加実装。要求書は変更しない。

- [x] 通常起動と文書引数を維持し、起動経路・隔離設定の引数を追加する。
- [x] 現在ユーザー専用の管理IPC、全ウィンドウへの最新終了可否照会、既存終了ガードを接続する。
- [x] 共通タイトルと非常駐の製品定義、利用手順を追加する。
- [x] Rust・frontendの関連試験、ビルド、親からの実プロセス連携結果を記録する。

本作業は常駐・自動起動・公開・インストールを含まない。未保存文書と利用者設定を保護する。

## 実装と検証結果

- `--launch-origin standalone|host_manual`と`--settings-dir`を追加。無表示起動・自動起動経路は拒否。通常の文書起動と単一起動を維持。
- 隔離設定は設定・AI関連データ・WebView2プロファイルだけでなく、設定先SHA-256先頭16桁で単一起動識別子と管理窓口も分離する。既存MSIX版を終了せずに実プロセス試験を実施。
- SID限定ACL、同一セッション、PID、要求IDと期限を検証する管理契約2を追加。stopは全画面の最新状態を照会し、既存closeガードを経由する。本文・認証情報は返さない。
- `npm test -- src/App.test.ts src/lib/management.test.ts`相当：2ファイル33件成功。pretestの型検査、共有167ファイル照合、UI／ブロック契約も成功。`npm run build`成功。Viteの500kB超chunk警告は残る。
- `cargo test --locked --offline`：199成功、失敗0、ignored 2（既存の実サービス試験）。`cargo build --locked --offline --features tauri/custom-protocol`成功。最終Rust試験・Debug buildにwarningなし。
- 親ToolManagerからの実プロセス連携19件成功：起動経路、版、誤PID／PID欠落拒否、未対応操作、同一PID再表示、最小化復元、二重起動、関連付け相当の2画面、全画面正常終了、設定分離、無表示起動拒否、再起動、最後の画面を閉じた後の実プロセス終了。

初回frontendは移動前`C:\develop\MdVisualizer`を指す互換junction4件とworkspace依存junction1件により失敗。現在の子フォルダー内へ接続し直した（Git対象外）。その後の型検査とbuildは成功。Rust初回はsandboxのMSVC lib.exeが1114で失敗し、同じlock・専用targetを許可環境で再実行して成功した。既存MSIXプロセス検出による連携中止後、設定別の識別子分離を補強して19件を完了。

子ログ：`logs/kotorintoys-20261025/`の`frontend-tests-final.log`、`frontend-build.log`、`rust-tests-isolated.log`、`desktop-build-isolated.log`。親連携の結果はKotorinToysの`dev/history/v0.1.11/logs/mdvisualizer-20261025/ipc-isolated-final.log`。画面の目視、実SharePoint、未保存文書を実操作で作る終了拒否、配布・導入の受入は対象外。未保存・保存中の保護はfrontend近接試験と既存終了ガードで検証した。
