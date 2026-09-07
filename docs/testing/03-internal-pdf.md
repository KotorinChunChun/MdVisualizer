# 内部PDFによる印刷受入

## 実行

Node.js 22.13以降（または24以降）、npm依存関係、Microsoft Edgeを使用する。

```powershell
npm.cmd ci
npm.cmd run test:print-pdf
```

既定ではインストール済みEdgeをheadlessで起動する。ブラウザーを別途指定する場合は、`PRINT_PDF_BROWSER_PATH`へChromium系実行ファイルの絶対パス、または`PRINT_PDF_BROWSER_CHANNEL`へPlaywrightのchannel名を設定する。ブラウザーの自動インストール、仮想プリンター登録、既定プリンター変更は行わない。

出力先は`tmp/print-pdf/<実行時刻>/`。各PDFと`report.json`に、ケース名、ページ数、バイト数、SHA-256、ブラウザー版、失敗内容を保存する。失敗時は終了コード1となり、前回成功のPDFを再利用しない。生成物はGit管理対象外である。

## 検査内容

- 製品の`MarkdownPreview`、`PresentationView`、`DelimitedTableBlock`、`PrintMetadata`と印刷CSSを、テスト専用entry pointでproduction bundleにする。
- 製品と共通の`useDocumentPrint`／`executePrintSession`を通し、出力deviceだけをPlaywrightの`page.pdf()`へ差し替える。
- 通常文書のlight／dark、日本語・コード・Mermaid・SVG、メタデータ非表示、折りたたみの現在状態／全展開、長文、プレゼン、選択表を検査する。
- PDF.jsで生成PDFを読み、A4寸法、本文、空白ページの不在、1スライド1ページ、ページング外を含む表のフィルター・降順・非表示列、対象外UIの除外を判定する。
- 出力後の印刷状態、メタデータ、折りたたみ、スクロール、選択表用DOMの復元を確認する。
- 成功、取消（`afterprint`）、タイムアウト、同期／非同期例外、出力中の早期`afterprint`は通常のVitestでも検査する。無人PDF出力自体には取消ダイアログはない。

localhostだけに接続できる新規ブラウザーcontextを使い、ユーザーのファイル、認証、既存ブラウザー、起動中のMarkdownViewerを使わない。OSのマウス・キー入力は送らない。

## CubePDFとOS印刷の扱い

CubePDFは、別PCでMarkdownViewerの印刷ダイアログから選択し、PDFに変換する手動受入に利用できる。ただし標準CubePDFにはGUIを非表示にして変換する設定がないため、GUIテスト禁止の当該PCでは無人印刷先にしない。CubeVPによるカスタムプリンター作成も今回の対象外とする。

内部PDFで保証するのは共通レンダラー、印刷CSS、PDF内容、印刷セッションの動作である。WebView2固有の印刷ダイアログ、OSスプーラー、CubePDFドライバー、RDPプリンター転送は別の受入項目として残す。draw.ioの外部iframe描画や実機資格情報もこのテストでは検証しない。

自動検査の対象は上記fixtureであり、任意の文書の見た目を網羅するものではない。印刷CSSを変更したときはPDFをPNGへ描画し、文字・図・改ページ・余白も確認する。PDF.jsでフォント命令の`TT: undefined function`警告が出た場合は、終了コード・本文検査結果と描画結果を分けて記録する。

参考: [Playwright PDF API](https://playwright.dev/docs/api/class-page#page-pdf)、[CubePDF公式FAQ](https://clown.cube-soft.jp/entry/cubepdf/faq/basic)。
