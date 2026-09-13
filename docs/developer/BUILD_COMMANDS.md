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

## デバッグ実画面確認

当該PCでは2026-09-13のユーザー指示により実画面テストを実施できます。起動中アプリの状態APIで未保存文書を確認し、応答がない場合や未保存文書がある場合は強制終了しません。テスト入力と出力は対象版のlogsに置き、デバッグアプリは既定で起動したままにします。

Web版は[Web版と共通編集・出力](/docs/developer/web/ARCHITECTURE.md)、PHP検証・設置は[PHP運用](/docs/developer/web/PHP_OPERATIONS.md)を参照してください。

次の操作には、それぞれの明示的な公開・配布依頼が必要です。

- 実SharePointへのアップロード・展開
- MSIX署名、インストール、FTP公開

これらは対応する明示依頼と公開手順に従って実施します。

## ビルドの競合回避と環境エラー

- SPFxとデスクトップの依存インストール・ビルドは共用領域で競合するため並列実行せず、順次実行する。両方が必要な場合はSPFx完了後にデスクトップを実行する。
- サンドボックスのコマンド起動失敗は製品不具合と区別し、実行環境とエラーを記録する。実行されていないテストを成功扱いにしない。
- SPFxの機能実装を依頼された場合は、その検証に必要なビルド・テストを実施する。App Catalogへのアップロード・展開は別の公開操作としてユーザー指示に従う。
- 回帰確認・静的検査・資料点検の入口は[検証手順](/docs/developer/testing/01-test-strategy.md)へ統一する。

## セットアップと補足検証

初回環境構築、デバッグ起動、MSIXと署名環境の準備は[開発環境のセットアップ](/docs/developer/DEVELOPMENT_SETUP.md)を参照してください。

### 全体検証

```powershell
npm test
npm run build
cargo test --manifest-path .\src-tauri\Cargo.toml
npm run tauri build
```

#### プリンターを使わない印刷テスト

`npm.cmd run test:print-pdf`で、画面を表示せずに通常文書・プレゼン・選択表をPDFへ出力し、内容とページ構成を検査できます。OSプリンターや保存ダイアログは不要です。設定、成果物、CubePDFを使う手動受入との区別は[内部PDFによる印刷受入](/docs/developer/testing/03-internal-pdf.md)を参照してください。

#### 性能測定

過去の測定例では、release EXEで10,000行のMarkdownを5回起動した測定では、起動時間の中央値は41ms、初回を含む最大は493ms、ワーキングセット最大は24.1MBでした。再測定には `dev/scripts/measure-performance.ps1` を使用します。
