# 開発・検証・Web公開の自動化

## 検証の入口

対象版を明示し、変更したホストを指定する。Node.js 22と既存の依存導入が必要。初回設定は[Web構成](/docs/developer/web/ARCHITECTURE.md)を参照する。

```powershell
cd C:\develop\MdVisualizer
./scripts/Invoke-Validate-MdVisualizer-all.ps1 -Version v0.0.18 -Target Static,Web,SPFx
# デスクトップを含む全対象
./scripts/Invoke-Validate-MdVisualizer-all.ps1 -Version v0.0.18
```

Staticは共有投影、依存境界、CSS、UI対応表、要求と試験入力、文書リンク、親子接続、TypeScriptを検査する。WebはVitestと単一HTML生成、DesktopはVitestとfrontend buildとRust、SPFxは埋込ツール生成とproduction test/packageを行う。Staticを先に指定して軽い不整合から検出する。署名、インストール、App Catalog公開は行わない。

工程のstdout/stderrは実行中から書き出し、既定30分で時間切れにする。時間切れでは自分で開始した子プロセスだけを終了し、失敗として記録する。

出力は `dev/history/<版>/logs/<RunId>/summary.json` と工程別ログ。同じRunIdを再利用せず、再実行も別の証跡にする。成功・失敗・未実行を区別し、Vitest件数は実JSONから取得する。JSONを出さない工程の件数はunavailableであり、推定して補わない。失敗した工程のログを読み、原因を直した後、必要な範囲だけ再実行する。

統合入口と限定Web公開は `.tools/validation-locks/shared-build.lock` で共有生成物への同時処理を防ぐ。個別のnpm/build入口を直接並列起動する場合にはこの保護はない。残ったlockは実行プロセスと未完了処理を調査し、自動削除・強制終了しない。

## UIの対応とデザイン

[全UI機能対応表](/docs/developer/ui/UI_COMMAND_MATRIX.md)は `config/ui-command-contract.json` から生成する。ホスト間の別実装・対象外・未対応の根拠は `config/ui-host-mappings.json` に置く。共有UI、Desktop、HTML/PHP、SPFxのJSX、DOM生成、コマンド定義を走査し、登録されていない追加・削除・名称・ソース順・属性・CSSの変更を失敗にする。

```powershell
npm run check:ui-contract
node scripts/test-ui-command-contract.mjs
```

意図したUI変更では、ソース差分と対応先をレビューし、必要ならhost-mappingsを修正してから、次の明示操作で基準と表を更新する。CIや通常のビルドから基準を自動承認しない。

```powershell
node scripts/ui-command-contract.mjs --accept-reviewed
npm run check:ui-contract
git diff -- config docs/developer/ui/UI_COMMAND_MATRIX.md
```

保存→HTML出力→差分→印刷は共通の相対順序。固有操作を間に置くことは許容する。書式17コマンドは共有リスト、表示切替は共有コンポーネントとCSSを使用する。コード/プレビュー/分割方向および差分の状態組合せはコンポーネント試験で検査する。

既存の `web-platform/scripts/check-ui-styles.mjs` がCSS値の分布と外れ値候補を出す。少数値は用途差もあるため、統計だけでは不具合と断定しない。対応表のCSS基準はレビュー後の値変更を検出する。動的ラベル、条件付き表示、CSSカスケード後の実寸、キーボード到達性は静的検査の合格に含めず、対象画面で確認する。対応表は実装に存在する操作の登録であり、全ホストで全機能が利用できるという宣言ではない。

## 要求・入力・テスト要件

追加要求は版別reqにIDを付け、`web-platform/tests/fixtures/<版>-ui-cases.json` と版別test-requirementsに同じIDを登録する。`node scripts/check-development-docs.mjs v0.0.18` で対応漏れとdocs内リンク切れを検出する。実行結果はimp、機械生成結果はlogsへ分ける。共有ソースへの生成JavaScript混入もsource-boundariesで検出する。

## 限定Web公開

既存テストサイトのHTML/PHP画面2ファイルだけを対象とする。PHP認証・設定・一時保管データには触れない。公開許可はユーザー指示から確認し、許可済みの範囲では再確認を要求しない。

```powershell
./scripts/publish-web-MdVisualizer-limited.ps1 -Version v0.0.18 -Mode Plan
./scripts/publish-web-MdVisualizer-limited.ps1 -Version v0.0.18 -Mode Publish -PublishConfirmed
./scripts/publish-web-MdVisualizer-limited.ps1 -Version v0.0.18 -Mode Verify
```

PythonがPATHにない場合は `-PythonPath <python.exeの絶対パス>` を付ける。Planは対象のサイズとSHA-256を保存する。PublishはWebsiteへのステージ、対象限定のドライラン、FTP転送、FTP読み戻し、HTTP/MIME/サイズ/ハッシュ検証を行う。PHP入口のHTTP 200と内部app.htmlの403も検査する。途中失敗でも成功済み工程をresult.jsonに残す。公開後の認証と画面操作は別途確認する。Gitコミットやpushは自動では行わない。

## 自動化自体の確認

```powershell
./scripts/test-validation-runner.ps1
python scripts/test-web-limited-publish.py
node scripts/test-ui-command-contract.mjs
```

これらは一時fixtureを使い、失敗JSON、未実行、重複実行、引数の空白、対象外公開、部分失敗、ハッシュ不一致、UI定義の追加・削除・変更を検査する。実サーバーへの転送は行わない。

### 対応表のツールバー・メニュー名と番号

各行のlocationに所属領域名、領域ID、領域内順序、番号（例: UI001-03）と順序の根拠を保持する。対応表は領域番号・項目番号順に表示する。既存のui-IDは識別用に維持し、UI番号は配置変更に合わせて更新する。

JSXの祖先コンテナー、HTMLのツールバー・メニュー・ダイアログ、コマンド配列から所属を求める。DesktopのHTML出力・診断は別部品でもAppの配置順へ合流する。子メニューは独立して1から採番する。動的DOM生成など所属や実表示順を確定できない行は、コンポーネント/関数名を含む操作領域名と「定義順（実表示順は要確認）」で表す。並び替えや非表示条件を推測で確定しない。

`npm run test:ui-contract` は所属と採番も検証する。通常の `check:ui-contract` は所属・番号の更新漏れを失敗にする。
