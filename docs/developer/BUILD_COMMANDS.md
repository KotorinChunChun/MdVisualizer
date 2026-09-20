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

日常のデバッグ、機能単位の受入、リリースを次の順に進めます。

| 段階 | 実施時期 | 方法 |
|---|---|---|
| 日常のデバッグ | 修正中 | `tauri dev`を継続起動し、frontendはHMRで確認。近接テスト・型・契約検査を実施 |
| 受入 | 機能単位の完了時・公開前 | フルデバッグビルド後に対象機能と関連回帰をGUI確認。性能を同条件で比較 |
| リリース | 公開指示を受けた後 | production成果物の起動・主要操作・版・署名・ハッシュを検証し、公開後に取得物を照合 |

### 日常のHMRデバッグ

```powershell
cd C:\develop\MdVisualizer
pwsh -NoProfile -File .\scripts\run-debug-MdVisualizer-all.ps1
```

この既存入口は`tauri dev`を実行します。初回起動の準備・コンパイル後はターミナルを維持し、React・TypeScript・CSSの修正をVite HMRで反映します。変更によって全画面再ロードになる場合もあるため、試験用文書を使用します。Rust変更時は監視による再コンパイル・再起動を確認します。

共有UIは`web-platform/packages/editor-ui/src/`を修正し、`npm.cmd run setup:web-platform`で投影を更新、`npm.cmd run check:shared`で一致を確認してHMR反映を確認します。共有coreや埋め込み生成物は必要なビルド・生成を行います。生成投影を直接編集しません。

### 受入用のビルドとGUI確認

`run-debug-MdVisualizer-all-smoke.ps1 -TargetVersion <対象版>`はフルビルドを伴う受入入口です。frontendの編集ごとには呼び出しません。`-SkipBuild`は対象ソースから生成された成果物と起動条件が確認できる場合だけ使用します。

実行ファイルのパス、ビルド種別、生成時刻、WebView接続先、対象タブ・表示モードを確認してから試験を開始します。空ページ、接続拒否、画像0件、対象タブ未選択は環境または試験準備の失敗として扱います。古いボタン名などでスモークが失敗した場合も成功へ読み替えず、ハーネスを修正して再検証します。

開発用と受入用の出力先は分離する方針です。現状の既存入口は同じdebug成果物を使うため、分離実装までは並行ビルドを避け、切替時に由来を確認して必要なら再ビルドします。Viteを参照する開発EXE単独の起動失敗を製品不具合と断定しません。受入用はViteへの依存がない成果物で確認します。

当該PCの実画面操作・状態API・未保存文書保護・強制終了条件は最新のAGENTS.mdに従います。製品の固定試験入力はsamples/tests、生成入力・証跡は対象版のlogsへ置きます。デバッグアプリは既定で起動したままにします。

Web版は[Web版と共通編集・出力](/docs/developer/web/ARCHITECTURE.md)、PHP検証・設置は[PHP運用](/docs/developer/web/PHP_OPERATIONS.md)を参照してください。

次の操作には、それぞれの明示的な公開・配布依頼が必要です。

- 実SharePointへのアップロード・展開
- MSIX署名、インストール、FTP公開

これらは対応する明示依頼と公開手順に従って実施します。

### リリース工程の入口

受入結果と未確認事項を確認し、現行仕様をdocsへ反映してからproduction成果物を生成します。生成した成果物自体で起動・主要操作を確認し、版・署名・ハッシュを検証します。公開後は配布ページの版・リンクと実際の取得ファイルを照合します。開発HMR、受入debug、productionの性能値は別々に管理します。

リリース工程の共通処理は`scripts/Invoke-MdVisualizerRelease.ps1`に集約しています。通常利用する工程別入口はすべてbeta固定で、利用者が確認スイッチやチャンネルを指定する必要はありません。stableは正式リリース時に`scripts/full-release-stable-MdVisualizer.ps1`だけを使用し、ビルドから公開後検証までを一括実行します。

通常のbeta更新は、Version更新、Plan確認、Full実行の順です。

```powershell
pwsh -NoProfile -File .\scripts\update-version-MdVisualizer.ps1
pwsh -NoProfile -File .\scripts\plan-release-MdVisualizer.ps1
pwsh -NoProfile -File .\scripts\full-release-MdVisualizer.ps1
```

`update-version-MdVisualizer.ps1`の入力は4桁版で、現在版より新しくする。同じ版を再指定すると更新不要として停止する。`plan-release-MdVisualizer.ps1`は読み取り専用であり、betaとstableのURLを併記するが、stableへ送信しない。`full-release-MdVisualizer.ps1`はbeta固定で、stable公開には使用しない。

BuildとStageが成功した後に、Python未検出などでPublishだけが失敗した場合は、成果物を作り直さず次で公開工程を再実行する。`$pythonPath`が空の場合はPythonのインストール場所を確認してから実行する。

```powershell
$pythonPath = Get-ChildItem -LiteralPath "$env:USERPROFILE\scoop\apps\python" -Filter "python.exe" -Recurse -File | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
pwsh -NoProfile -File .\scripts\Invoke-MdVisualizerRelease.ps1 -Mode Publish -Channel beta -ReleaseIntentConfirmed -PublishConfirmed -PythonPath $pythonPath
```

工程別に実行する場合は、次のbeta固定入口を使用する。`build`と`stage`の後に`publish`を実行する場合も、公開前に`verify`を挟む。

```powershell
pwsh -NoProfile -File .\scripts\build-release-MdVisualizer.ps1
```

```powershell
pwsh -NoProfile -File .\scripts\stage-release-MdVisualizer.ps1
```

```powershell
pwsh -NoProfile -File .\scripts\verify-release-MdVisualizer.ps1
```

```powershell
pwsh -NoProfile -File .\scripts\publish-release-MdVisualizer.ps1
```

既存の`publish-release-MdVisualizer-all.ps1 -Mode <Mode>`と`publish-MdVisualizer.ps1`は互換入口として残しています。stableの正式リリースは次の入口だけを使用する。

```powershell
pwsh -NoProfile -File .\scripts\full-release-stable-MdVisualizer.ps1
```

これらの公開系コマンドは確認だけの説明ではなく、実行時に成果物生成または外部公開を行う。

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
