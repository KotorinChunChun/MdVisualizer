# KotorinToys管理連携の検証

KotorinToys親リポジトリで`pwsh -NoProfile -File dev/scripts/Test-MdVisualizer.ps1`を実行する。専用Node.js／Cargo環境を使用し、frontendの関連試験・build、Rust試験、専用targetへのDebug build、本体登録・実プロセス連携試験を行う。同じ試験EXEが既に起動していれば中止し、自動終了させない。別配置の通常版とは設定・単一起動識別子・管理窓口を分離する。生ログは対象版のlogsへ保存する。

開発EXEは`src-tauri/target/kotorintoys/debug/mdvisualizer.exe`。`--settings-dir`で通常設定、AI会話・記録・スキル、WebView2プロファイルを分離する。試験で作成した文書だけを使用し、終了拒否は成功へ置き換えない。共有UIの正本は編集せず、従来の投影を照合する。移動後に旧パスを指すjunctionが残る場合、リンク先を確認して現在の子フォルダー内へ修復し、依存再導入や版更新とは区別する。

管理契約2の`status/show/stop`はSID専用pipeで処理する。`show/stop`には一致するexpectedPidが必要。全ウィンドウの受信準備後にreadyとし、stopの都度、全ウィンドウから最新の可否を受け取る。未保存・保存中・読込中・編集ダイアログ・期限超過を拒否する。受理後も既存closeガードを経由し、照会直後に文書が変化した場合も保護する。

利用操作と引数は[利用者向け説明](../../user/KOTORINTOYS.md)を参照する。実画面・外部サービス・配布物の受入はコマンドライン試験と区別する。
