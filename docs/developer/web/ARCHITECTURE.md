# Web版と共通編集・出力の構成

## ソースの正本と投影

Web系のcanonicalは子リポジトリ `web-platform/` です。親リポジトリの `web/`、`spfx/`、`packages/markdown-core/`、HTML export関連の旧パスは、`scripts/setup-web-platform.mjs` が作成する互換リンクです。初回取得時は `git clone --recurse-submodules` を使い、既存チェックアウトでは次を実行します。

```powershell
git submodule update --init --recursive
node scripts/setup-web-platform.mjs
npm.cmd ci
Push-Location web-platform
npm.cmd ci
Pop-Location
```

134個の `src` 投影を含む共通UIの唯一の正本は `web-platform/packages/editor-ui/src/` です。投影先を手修正せず、子側を変更して同期してください。手修正混入は同期時のハッシュガードで検出します。

版情報は `web-platform/targets.json` の対象別設定で管理します。デスクトップ版の版番号とは独立しており、生成・設定変更は子リポジトリの `scripts/generate-targets.mjs` と `scripts/set-target-version.mjs` を使用します。

## 生成入口

`npm.cmd run build:embedded`で、Mermaid編集の共通ホストとHTML出力用ブラウザーバンドルを生成します。正式ソースは`web-platform/tools/mermaid-editor/`で、研究原本はビルドに使いません。生成器でsrcdoc通信、組込サンプル、ホスト専用画面調整を適用します。`src/generated/`と`spfx/src/generated/`は生成物で、Gitには含めません。

`npm.cmd --prefix web-platform run build:web`は分割ソース`web-platform/apps/web/src/`をViteでビルドし、HTML版とPHP版で共有する成果物を生成します。SPFxは`npm.cmd --prefix web-platform run build:spfx`でビルドします。生成HTML内へ未処理のimportや別ファイルのCSS参照を残さないこと、`file://`で実行できることを受入で確認します。

デスクトップ/SPFxの生成入口も共通ホストを先に生成します。SPFxではリポジトリ外rootDir参照を避けるため、同じ編集・出力処理を生成モジュールへバンドルします。

## 境界と保存

Mermaidエディターはiframe内で編集し、contentWindowとnonceを照合したpostMessageでホストへ本文を返します。ホストが元ブロックの位置・内容を検証して反映します。保存権限と元文書の所有権はホスト側にあり、エディターから原本を直接保存しません。試作内の編集フォームを動かすため、ホストiframeにはscripts、same-origin、modals、formsの許可が必要です。

ブラウザーHTML出力は`web-platform/packages/editor-ui/src/lib/htmlExport.ts`を共通入口にし、ホストからsnapshotと資産読込callbackを受け取ります。画面外の専用iframeへ描画し、HTMLを完成してから保存します。図はSVGを優先し、HTML内包図はData URL SVGをキャンバスへ描画してPNG化します。Blob URLのSVGを使用するとforeignObjectでcanvasが読み出せないブラウザーがあるため、画像化の入力はUTF-8 Base64のData URLを使用します。

デスクトップはネイティブ保存ダイアログとRustの`save_html_export`を使います。保存対象はHTML拡張子・絶対パスに限定し、原本との同一性、通常ファイル、上限を検証してロック内で原子的に置換します。SPFxは既存のSharePoint保存・認証・eTag処理を維持し、認証済み資産読込を出力用callbackへ接続します。

Web版の`DocumentSession`は本文、ZIP内の相対文書名、文字コード、BOM、資産Blobを保持します。入力の検証・展開・復号がすべて成功するまで現在の文書を交換しません。ZIP保存では元の文書パスと資産パスを保持します。ブラウザー内下書きはIndexedDBへ同じセッションを保存し、初回復元判断が完了するまで自動保存を開始しません。

PHPは暗号化ZIPを復号せず、SSO・所有者分離・期限・quota・構造検査・送受信のみを担当します。[PHP運用](/docs/developer/web/PHP_OPERATIONS.md)を参照してください。

## 検証入口

```powershell
npm.cmd test
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm.cmd --prefix spfx test
node scripts/test-mermaid-editor-runtime.mjs
node --test tests/html-export/browser-bridge.test.mjs
node --test tests/web-image-editor.test.mjs
npx.cmd vitest run --config web/vitest.config.ts
npx.cmd tsc -p web/tsconfig.json
npm.cmd run build:web
node web/test-file-build.mjs
node web/tests/ui-acceptance.mjs
node web/tests/php-http-integration.mjs
node web/tests/php-browser-integration.mjs
```

`ui-acceptance.mjs`は390pxのタッチ模擬で本文・表・Mermaidを操作し、ソース表示からも全文を印刷用iframeへ渡すことを確認します。印刷装置への呼び出しは差し替えて検査するため、紙への出力やOS印刷ダイアログの試験ではありません。PHP試験の認証は試験専用セッションであり、本番コードにログイン迂回経路を設けません。

実SSO、SPFx実サイトでの認証資産取得、iPhone/Android実機の操作は、ローカル単体試験やデスクトップブラウザーのタッチ模擬とは分けて記録します。テストの画像・動画・生成HTMLは対象版のlogsへ置きます。

## 検証の自動化

子の`npm run test:ui-static`はCSSの高さ・余白・文字サイズ等を用途別に集計し、少数値候補を版別ログへ記録します。ボタンのインラインstyleや子の外部へのソース参照は失敗として扱い、Web/SPFxビルド前にも実行します。少数値だけでは不具合と断定せず、画面寸法検証と組み合わせます。

親の`node scripts/test-web-platform-setup.mjs`は新規投影、再生成、差分検出、手修正保護、パス逸脱拒否を検証します。親の履歴を保持したまま子Gitへ移管しており、共通コード更新時は子をコミットしてから親のsubmodule参照をコミットします。
