# MdVisualizer ビルド・検証コマンド

すべてリポジトリルート`C:\develop\MdVisualizer`から実行します。PowerShellは`pwsh`を使用し、PowerShell実行ポリシーの影響を避けるためnpmは`npm.cmd`を使用します。

## 依存導入

```powershell
npm.cmd install
```

依存導入はロックファイルと既存環境を確認してから行います。オフライン環境では新しい依存解決を開始しません。

## デスクトップfrontend

```powershell
npm.cmd test
npm.cmd run build
```

`npm.cmd run build`は共有coreのビルド、TypeScript型検査、Vite production buildを含みます。対象が限定できる場合は、先に次の形式で近いVitestを実行します。

```powershell
npm.cmd test -- <対象testファイル>
```

## Rust backend

```powershell
cargo test --manifest-path .\src-tauri\Cargo.toml
```

Tauriのdesktop成果物生成は通常のfrontend buildとは別です。成果物生成が受入条件に含まれる場合だけ、明示して実行します。

## SharePoint Framework

```powershell
npm.cmd --prefix .\spfx test
npm.cmd run build:spfx:local
```

`build:spfx`と`build:spfx:local`は、どちらもApp Catalogへアップロードしないローカルproduction buildです。公開は`pwsh -NoProfile -File .\scripts\publish-release-MdVisualizer-spfx.ps1 -PublishConfirmed`を明示的に使用し、全サイト展開が必要な場合だけ`-Deploy`を追加します。

## スクリプトと配布安全性

```powershell
npm.cmd run test:run-scripts
npm.cmd run release:test-safety
```

これらはスクリプトの命名・安全契約を検証します。署名、成果物生成、ステージング、アップロード、インストール自体は行いません。

## 当該PCで実行しないもの

- `npm.cmd run debug:smoke`
- 自動マウス・キー入力、画面capture
- 実SharePointへのアップロード・展開
- MSIX署名、インストール、FTP公開

これらは対応する明示依頼と、必要な別PC・専用runner・公開手順がある場合だけ実施します。

## ビルドの競合回避と環境エラー

- SPFxとデスクトップの依存インストール・ビルドは共用領域で競合するため並列実行せず、順次実行する。両方が必要な場合はSPFx完了後にデスクトップを実行する。
- サンドボックスのコマンド起動失敗は製品不具合と区別し、実行環境とエラーを記録する。実行されていないテストを成功扱いにしない。
- SPFxのsppkg生成・テスト・アップロードは当面保留。[保留案](../dev/PLAN_IDEAS.md)の再開指示があるまで上記SPFxコマンドを実行しない。手順の存在は実行許可を意味しない。
- 回帰確認・静的検査・資料点検の入口は[検証手順](testing/01-test-strategy.md)へ統一する。
