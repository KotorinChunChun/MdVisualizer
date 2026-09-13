# HTML出力CLI

Markdownを閲覧用の単一HTMLへ変換する独立CLIです。MdVisualizerアプリを起動せず実行できます。アプリのボタンにはまだ組み込んでいません。

本文と表はHTML、図はSVGまたはPNG、画像はData URLとして保存します。完成したHTMLは、元のMarkdown・画像フォルダー・JavaScript・ネット接続なしで通常のブラウザーから閲覧できます。コピー・編集・図の切替・目次検索などのアプリ操作は含みません。

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

## 図と外部資産

- 見出しや表のページ送りは持ち出さず、全文・全行・全列を出力します。表の集計はアプリと同じ計算器を使います。
- Mermaidは組み込み依存の描画エンジンで生成時に描画します。HTMLラベルを含む図は、ブラウザー上の図要素だけをPNGとして取得します。
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
});
```

入力・テーマ・CSS・保存先を渡す契約としており、TauriコマンドやアプリのUIを呼びません。ブラウザー内の変換処理は`scripts/html-export/browser.tsx`、資産読込と保存は`io.mjs`に分離しています。新しい依存パッケージは追加していません。
