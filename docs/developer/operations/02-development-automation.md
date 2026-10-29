# 開発・検証・Web公開の自動化

## 検証の入口

日常のfrontend確認は`run-debug-MdVisualizer-all.ps1`のHMRを使用します。以下の統合検証は変更範囲と機能完了時の受入条件に応じて選び、frontendの保存ごとに全件実行しません。工程の選択は[ビルド・検証コマンド](/docs/developer/BUILD_COMMANDS.md)、性能比較は[性能回帰測定](/docs/developer/testing/06-performance-regression.md)に従います。

対象版を明示し、変更したホストを指定する。Node.js 22と既存の依存導入が必要。初回設定は[Web構成](/docs/developer/web/ARCHITECTURE.md)を参照する。

```powershell
cd C:\develop\MdVisualizer
./scripts/Invoke-Validate-MdVisualizer-all.ps1 -Target Static,Web,SPFx
# デスクトップを含む全対象
./scripts/Invoke-Validate-MdVisualizer-all.ps1
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
./scripts/publish-web-MdVisualizer-limited.ps1 -Mode Plan
./scripts/publish-web-MdVisualizer-limited.ps1 -Mode Publish -PublishConfirmed
./scripts/publish-web-MdVisualizer-limited.ps1 -Mode Verify
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

全操作の登録表は `docs/developer/ui/UI_COMMAND_MATRIX.tsv` へ生成する。Markdownには説明とTSVへのリンクのみを残す。TSVはUTF-8・ヘッダー付きの11列で、タブ・改行・引用符を含むセルは引用符で囲み、セル内の引用符を二重化する。`check:ui-contract` でTSVの更新漏れも検査する。

### 折畳メニューと広幅コピーの回帰

通常の `npm test` の前処理でも子側の `check-ui-styles.mjs` を実行する。メニュー用chevronの共通コンポーネント利用、旧文字記号の混入、広幅コピー候補の共通寸法・色・枠・背景・フォントの欠落を静的に検出する。壊した入力による自己検証も同時に実行する。CSS統計の外れ値レポートと併用し、静的合格と実寸・実操作の確認は分けて記録する。

## 高速検証（普段の変更確認）

GUIの時間計測と選択は[GUIシナリオ](/docs/developer/testing/08-gui-scenarios.md)を使用する。`debug:gui -- --version <版> --plan-only --changed <相対パス>`で先に要否を確認し、`test:gui-smoke`で選択・計測基盤自体を検証できる。

対象版を明示します。以下の例のv0.0.19は実際の対象版へ置き換えます。各コマンドの--version引数でも指定できます。package版から開発対象版を推測しません。

```powershell
$env:MDVISUALIZER_VERSION = 'v0.0.19'
npm.cmd run validate:fast
# 型検査まで。初回は必要な埋込生成も行う
npm.cmd run validate:quick
# 変更した共有ソースに依存するDesktopテストだけをVitestで選択
npm.cmd run validate:fast -- --related src/lib/drawio.ts
# キャッシュを使わず静的検査を再実行
npm.cmd run validate:fast -- --force
# 遅いテストを計測。全件、または末尾へ対象ファイルを指定
npm.cmd run test:profile
npm.cmd run test:profile -- src/lib/delimitedTable.test.ts src/lib/tableAggregation.test.ts
```

fastは共有投影、UI一覧、コマンド配線契約、各メニュートリガーとCSSを検査する。quick/relatedはその後に埋込生成と増分TypeScript検査を行う。関連テストの選択はVitestの依存関係解析を使い、共有正本のパスはDesktop投影パスへ変換する。src外の設定変更、Rust、Web/SPFx固有変更にはrelatedだけを使わず、従来の対象別検証を行う。関連テストが見つからない場合を成功扱いにしない。

高速入口は通常のnpm testやリリース検査を置き換えない。npm testにも増分型検査を先行させ、全件テスト後に型エラーが分かる手戻りを減らす。DOMに依存しないことを確認したテストだけ `@vitest-environment node` を指定する。Testing Library・SVG sanitizer・DOM操作を含むテストの環境を一括変更しない。

### キャッシュの成立条件

scripts/validation-cache.mjsは入力の内容、ファイル追加/削除、Node版・OS・アーキテクチャをハッシュ化する。入力にはソース、検査スクリプト、仕様表、設定、依存lockを含める。生成キャッシュは出力の内容と存在も照合し、更新日時だけでは再利用しない。共有投影の手修正保護はキャッシュ時も実行する。失敗・実行中の入力変更では成功記録を保存しない。同一工程のロックが残っていれば所有プロセスを確認し、自動で削除しない。

判定はpassed（今回実行）とcached（同じ入力の過去成功を再利用）を分け、元の検証日時と今回の所要時間をJSONに記録する。署名・アップロード・公開物取得・GUI受入にはこの成功キャッシュを適用しない。依存パッケージの手修正などlockに表れない変更を行った場合は依存を再導入し、--forceで再検証する。

埋込生成の再利用は `npm run build:embedded` に組み込み済み。強制生成は `node scripts/build-embedded-tools.mjs --force`。内容が変わったときは子側のmtime判定も強制更新し、過去日時のファイルへ差し替えた場合も取りこぼさない。

### コマンド仕様と外部通信

`config/block-command-semantics.json` は承認済みブロック仕様への参照と実装経路を持つ。`check:block-commands` は固定表示、狭幅コピー、AIのホスト条件、編集の保存コールバックを実コードへ照合する。UI一覧の基準更新からこの仕様を自動生成・自動承認しない。静的解析が理解する現在の配線パターンの検査であり、任意のJavaScript条件式の証明や全状態の実描画検査ではない。比較表の古い現状欄は再確認候補として別出力し、現在の未実装と断定しない。

draw.io exportの応答形は `web-platform/tests/fixtures/drawio-embed-protocol.json` に公式参照元とともに固定した。実際の保存画面が使う純粋helperをNodeテストから呼び、旧要求、不正な形式、未要求応答を検査する。iframeの送信元確認とSVGの安全性検査は既存のUI/DOMテストに残す。

### 寸法確認と重いテストの調査

`npm run ui:fixture` で、製品の共有CSSを読む小型の実寸確認HTMLを版別logsへ生成する。生成成功とブラウザー上での寸法合格は別結果。実寸と指定幅、高さ不足、高さの不一致を確認する。製品の全ツールバー生成・開閉・実OS操作を置き換えるものではない。

`test:profile` は全テストまたは指定テストの実時間とファイル別時間を保存する。並列実行なのでファイル時間の合計を経過時間と扱わない。計測前の生成処理は含まないため、必要なら先にbuild:embeddedを実行する。次の高速化は記録から優先順を決める。

- jsdom起動が支配的: 純粋処理テストを個別にNodeへ移す。
- import/transformが支配的: 巨大なUIモジュールへの依存を純粋関数・小さいadapterへ分離する。
- waitFor/timeoutが支配的: sleep短縮や無条件retryではなく、待っている状態の条件と非同期処理を修正する。
- worker増加で遅くなる: 同じ対象でworker数を比較する。全CPU使用を無条件に高速とはみなさない。

自動化自体は `npm run test:validation-cache`、`npm run test:block-commands` と既存のUI静的検査に内蔵した破壊fixtureで確認する。

`test:block-commands` は通常の `npm test` のpretest、高速検証、統合検証のStaticに組み込む。固定項目の退避、保存処理の未接続、閲覧時操作を消す追加条件、ホスト契約の無効化を意図的に与え、検出器が失敗を返すことを検査する。基準の操作数が一致するだけでは合格にしない。操作ポリシーと必須接続契約、幅別の描画、コピー共通処理の動作はVitestでも確認する。
