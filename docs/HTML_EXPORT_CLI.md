# HTML出力CLI

状態: 2026-09-13、ユーザー確認により独立CLIは完成。本体統合は未実装。[本体導入引継ぎ](HTML_EXPORT_INTEGRATION.md)に確定仕様・API・統合時の検証項目をまとめています。

Markdownを閲覧用の単一HTMLへ変換する独立CLIです。MdVisualizerアプリを起動せず実行できます。アプリのボタンにはまだ組み込んでいません。

本文と表はHTML、図はSVGまたはPNG、画像はData URLとして保存します。完成したHTMLは、元のMarkdown・画像フォルダー・JavaScript・ネット接続なしで通常のブラウザーから閲覧できます。既定のstaticモードには操作ボタンやスクリプトを含みません。interactiveモードでは小さな内蔵スクリプトでコピー・折り返し操作を追加し、目次から見出しへ移動できます。描画エンジンはどちらのモードにも含みません。

## 実行

既存のプロジェクト依存関係がインストール済みであることが前提です。生成にはNode.jsとChromium系ブラウザーを使用します。検証環境はWindows、Node.js 24.19.0、Edgeです。Windowsではインストール済みEdge、Chromeを順に探します。別の場所にある場合は`--browser`を指定します。

```powershell
Set-Location C:\develop\MdVisualizer
node .\scripts\export-html.mjs .\samples\html-export.md --output .\preview.html
```

既に出力先がある場合は、上書きを許可する`--force`を追加します。保存先の親フォルダーはあらかじめ作成してください。出力先は`.html`または`.htm`です。

```powershell
node .\scripts\export-html.mjs .\samples\html-export.md --output .\preview.html --theme light --force
node .\scripts\export-html.mjs --help
```

未保存の本文を渡す用途では、標準入力を使えます。ファイル入力時の画像参照は入力ファイルの場所、標準入力時は`--base-dir`（省略時は現在のディレクトリー）を基準に解決します。

```powershell
Get-Content -Raw .\samples\html-export.md | node .\scripts\export-html.mjs - --base-dir .\samples --output .\preview.html --force
```

## オプション

| 引数 | 内容 |
|---|---|
| `入力.md`または`-` | Markdownファイル、または標準入力 |
| `--output`, `-o` | 保存先。必須 |
| `--mode` | `static`（既定・スクリプトなし）／`interactive`（操作付き） |
| `--theme` | `dark`（既定）、`light`、`github`、`solarized`、`nord` |
| `--css` | 本文に追加するCSSファイル。`:scope`を本文のルートとして使える |
| `--title` | HTMLのタイトル。省略時は入力ファイル名、標準入力では「無題」 |
| `--base-dir` | 標準入力時だけ指定する資産の参照元ディレクトリー |
| `--allow-remote` | HTTP(S)資産・draw.ioビューアーの取得を許可 |
| `--drawio-viewer` | 手元の信頼する`viewer-static.min.js`を使う |
| `--browser` | 生成用Edge/Chrome等の実行ファイルの絶対パス |
| `--force` | 既存HTMLへの上書きを許可 |
| `--help`, `-h` | 使用方法 |

テーマは引数から固定し、閲覧先OSのテーマでは変化しません。起動中アプリの設定・タブ・下書きやSharePointの認証情報は読み取りません。現在のアプリと配色を合わせる場合は、同じテーマを指定してください。

追加CSSの例:

```css
:scope p { font-size: 18px; line-height: 1.8; }
:scope h2 { color: #2563eb; }
```

追加CSSは本文の静的な装飾向けです。外部画像・外部フォント・import・URL参照・CSSエスケープ等は拒否します。ブラウザーで計算した文字色、背景色、フォント、罫線、余白等をHTML内へ固定します。任意のWebページ全体のレイアウトやアニメーションを移植する機能ではありません。

## 出力モード

```powershell
node .\scripts\export-html.mjs .\samples\html-export.md --output .\preview-static.html --mode static
node .\scripts\export-html.mjs .\samples\html-export.md --output .\preview-interactive.html --mode interactive
```

| 機能 | static | interactive |
|---|---|---|
| 本文・SVG図・画像・表、言語名とファイル名 | あり | あり |
| JavaScript | 一切なし | 操作用の内蔵スクリプトのみ |
| コードと表のコピー | なし | 右上に表示。表は見出しと集計値を含むTSV |
| 右端での折り返し | 切替なし | コードと表の右上ボタンで切替。元データは変更しない |
| 軽量な目次 | なし | 右上固定の「目次」を開き、見出しをクリックして移動 |

追加の閲覧機能（interactiveのみ）:

- コピーの成功・失敗を画面下部の通知で表示し、最後の通知から約3秒で消します。
- 図・画像をクリック、またはフォーカスしてEnter／Spaceで拡大表示します。拡大・縮小・画面に合わせるボタンがあり、Escまたは閉じるボタンで戻れます。SVGはベクターのまま表示します。
- H2〜H6の見出し左の矢印で、その章を折りたたみます。H1は残します。目次内にすべて展開／すべて折りたたむ操作があります。目次やURLの見出しリンクで移動すると、その章を展開します。
- 表の見出し横の矢印で昇順→降順→元の順に切り替えます。数値同士は数値として比較し、それ以外は日本語の文字列比較を使います。同値の順序を維持します。
- 表の検索欄は全列を対象に、大文字・小文字を区別しない部分一致です。複数語のAND検索や正規表現ではありません。検索欄を空にすると全行に戻ります。
- 合計・平均・個数の集計行は並べ替え時も末尾に残し、絞り込み時も表示します。集計値は元の全行に対する値を保持し、「集計は全行」と表示します。コピーは現在の並び順・表示行と見出し・集計行が対象です。

interactiveでもオフライン閲覧できます。JavaScriptが禁止された環境ではコピー・折り返しボタンを非表示にし、本文はそのまま閲覧できます。目次はHTMLの標準リンクです。コピーはClipboard APIを優先し、利用できない場合はブラウザーのコピー処理へ切り替えます。ブラウザーが両方を拒否した場合は失敗を表示します。

コードのコピーはコード本文のみです。表はタブ区切りと改行でコピーし、セル内のタブ・改行・引用符は引用符で囲んでエスケープします。折り返しは画面内の本文幅に合わせます。印刷時には操作ボタンと目次を隠し、折りたたんだ章と絞り込んだ行も表示します。

言語・ファイル名は別枠の見出しにせずコードと同じ背景に小さく配置します。[GitHubのコード表示資料](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-and-highlighting-code-blocks)を参考にしていますが、ファイル名指定は本CLIの既存記法・追加対応記法です。

## 図と外部資産

- 見出しや表のページ送りは持ち出さず、全文・全行・全列を出力します。表の集計はアプリと同じ計算器を使います。
- Mermaidは出力専用の描画設定でHTMLラベルを無効にし、フローチャートの線と文字をSVGとして保存します。文書由来の設定は引き続き除去します。外部SVGやdraw.io等でHTMLラベルが残る図は、図要素だけをPNGとして取得します。
- コード枠内の左上に小さく言語名とファイル名を表示します。言語未指定はtextです。ファイル名は`typescript:src/main.ts`、`typescript title="src/main.ts"`、`filename="main.ts"`、`file="main.ts"`、既存の直前見出し／太字コードによるパス表記を扱います。ファイル名を表示するためにそのファイルを読み込むことはありません。
- PlantUMLはアプリと同じローカル変換範囲（基本シーケンス・クラス・アクティビティ図）を扱います。外部includeや未対応構文はエラーになります。
- SVGコードブロック、本文中SVG、外部SVG、PNG/JPEG等の画像、外部`.mmd`・`.mermaid`・`.drawio`・CSV/TSV、Obsidian形式の画像参照を扱います。
- SVGの外部`use`参照は現段階では非対応です。外部図を自己完結したSVGへ変換して指定してください。欠落した図で出力を続行することはありません。
- draw.ioの非圧縮・圧縮データを扱い、複数ページはすべて出力します。描画時のビューアーは、`--allow-remote`で公式の`https://viewer.diagrams.net/js/viewer-static.min.js`から取得するか、`--drawio-viewer`で指定します。HTMLにビューアーや編集XMLは含めません。

```powershell
node .\scripts\export-html.mjs .\document.md --output .\document.html --allow-remote
node .\scripts\export-html.mjs .\document.md --output .\document.html --drawio-viewer C:\tools\viewer-static.min.js
```

図や画像は生成時に読み取ります。認証が必要なSharePoint文書は、文書と資産をローカルに用意してください。アプリの認証経路への接続は今後の統合範囲です。通常のWebリンクは残しますが、リンク先文書を自動収集しません。ローカル・Markdown・アプリ専用リンクは表示文字列のみを残します。

## 保存と制限

成功時は保存先、HTMLのバイト数、処理項目数、図・表・PNG変換件数をJSONで標準出力へ表示します。進捗は標準エラー出力へ表示します。失敗時の終了コードは1、成功時は0です。Ctrl+Cで中止できます。

入力文書や参照資産への上書きを拒否し、HTMLを一時ファイルへ書き終えてから保存先へ反映します。画像取得・描画・書き込みに失敗した場合や中止時には、既存HTMLを保持します。未対応の図をコードやプレースホルダーへ置き換えて成功扱いにしません。

上限はMarkdown 8 MiB、資産ごと32 MiB、読込資産合計と完成HTMLそれぞれ128 MiB、生成処理120秒、HTTP転送5回です。PNG化する図は最大辺8192 CSS px、2倍解像度で1600万画素までとします。本文全体の巨大なスクリーンショットは作りません。

## 検証

```powershell
node --test .\tests\html-export\io.test.mjs .\tests\html-export\export.test.mjs
node .\node_modules\typescript\bin\tsc -p .\scripts\html-export\tsconfig.json
```

実draw.ioビューアーを使うテストは次のとおりです。環境変数未指定時はこのテストのみskipし、実draw.io成功とは扱いません。

```powershell
$env:HTML_EXPORT_DRAWIO_VIEWER = 'C:\tools\viewer-static.min.js'
node --test .\tests\html-export\drawio.test.mjs
```

テストでは元画像を削除し、HTMLを別フォルダーへ移してJavaScript無効・オフラインのブラウザーで開きます。125行の表、図の復号、明暗テーマ、CSS、失敗時の元ファイル保持を確認します。スクリーンショット等は`tmp/html-export/`へ出力します。

WindowsのEdgeでの結果と、Firefox・Safari・iPhone/Android実機の確認は区別します。後者は未確認です。メール本文やサービス内の簡易プレビューなど、HTMLやData URLを制限・改変する環境までは保証しません。

## 再利用する入口

`exportHtml`はCLIの引数解析と分離したNode.jsの関数です。

```javascript
import { exportHtml } from './scripts/html-export/export.mjs';

await exportHtml({
  markdown: '# 本文\n\n文章です。',
  baseDir: 'C:/documents',
  output: 'C:/documents/preview.html',
  theme: 'dark',
  mode: 'static', // またはinteractive
});
```

入力・テーマ・CSS・保存先を渡す契約としており、TauriコマンドやアプリのUIを呼びません。ブラウザー内の変換処理は`scripts/html-export/browser.tsx`、資産読込と保存は`io.mjs`に分離しています。新しい依存パッケージは追加していません。
