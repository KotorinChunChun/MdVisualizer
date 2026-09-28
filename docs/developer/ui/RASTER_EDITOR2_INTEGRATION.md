# 画像注釈HTMLの統合

`web-platform/reference/screenpresso-original.html`がユーザー提供HTMLの保存原本です。SHA-256は`B2761C48EDCCD297FF6916507EE1AFE1BA1BFBC8DE4000483E0A89C37F0B5F80`。製品用のassets/rasterEditor2.htmlで名称と書出し表示を変更し、`rasterEditor2Host.ts`でCSPと通信処理を付加します。

DesktopのAppとWebImageEditorは共通のImageEditingDialogを呼び出します。PNG/JPEGは新旧を選択し、それ以外は従来のImageAnnotationEditorへ渡します。SPFxに編集起動経路は追加していません。操作方法は[画像編集](/docs/user/ui/image-editing.md)を参照してください。

## 隔離と保存契約

iframeは`allow-scripts allow-modals allow-downloads`のみ許可し、same-originを付けません。CSPで外部通信・フォーム送信・外部スクリプトを禁止し、画像はdata/blobのみ許可します。親側が画像をPNG化して送り、HTML側が注釈を合成してPNGを返します。送信元Window・通信チャネル・起動ごとの識別子・保存要求IDを確認し、未要求・重複・別画面からの結果を受理しません。

親の「反映」は既存のsaveRenderedImageまたは埋込／SharePoint／WebのonApplyへ渡します。外部保存は既存のファイルロック・バックアップ・原子的置換と寸法確認を使用し、追加で画像versionの変化を反映前に照合します。同寸法の外部更新をファイル内容ハッシュで原子的に検出する仕組みは既存APIにはなく、version通知での検出範囲に留まります。

JPEGへ保存する場合はRGBAを白背景へ合成してからエンコードします。保存失敗時は元ファイルと編集画面を保持します。PNG応答の形式と署名を確認し、保存要求には15秒の応答待ち上限を設けています。Tauri保存開始後はその処理結果を待ちます。

デスクトップの外部画像は共通選択画面でread_image_for_editを呼び、Rustでデコード・PNG化したData URIを両画面へ渡します。asset URLをCanvasへ直接描画するとWebViewの異なるoriginにより出力不能になるためです。差替え画像も同じ経路を使います。HTMLはラスタ編集2を選択した時だけ起動します。親srcへのHTMLを含む投影はsource-mapで管理し、UIインベントリーでは投影を二重に数えません。

## 検証

- `npm.cmd test -- src/components/RasterEditor2.test.tsx src/components/ImageAnnotationEditor.test.tsx src/App.test.ts`
- `node --test tests/web-image-editor.test.mjs tests/rasterEditor2-editor.test.mjs`
- `cargo test --manifest-path src-tauri/Cargo.toml image_ops::tests`
- `npm.cmd run check:shared`、`npm.cmd run check:ui-contract`、frontend／debugビルド。

ブラウザー試験はPNG/JPEGの読込み・実マウスでの注釈描画・出力画素の変化・キャンセル・従来画面を検証します。Windows実画面受入では試験文書だけを使い、元ファイル形式、バックアップ、キャンセル時のハッシュ不変を確認します。性能比較は[性能回帰測定](/docs/developer/testing/06-performance-regression.md)の基準整備状況と分けて記録します。

## 新規作成と外部エディター

read_image_for_editはファイル不在のみnullを返し、破損・権限・サイズ超過はエラーにします。欠落したローカルPNG/JPEGのエラー表示から選択画面へ入り、白背景のData URIを作ります。create_rendered_imageはPNG/JPEGへ変換後、create_newで排他的に保存します。既存ファイルは変更しません。既存画像の保存は従来のバックアップ付き経路を維持します。

ラスタ編集1は従来画面、ラスタ編集2は提供HTMLです。Windowsペイントは既存の外部アプリ起動APIからmspaint.exeへファイル引数を渡します。System32とWindowsAppsの実行エイリアスを探索し、Paintがスラッシュ区切りを誤解釈しないようファイルパスをWindows形式へ正規化します。新規画像の場合は白紙を排他的に作成してから起動します。デスクトップの外部ローカル画像に限定し、Web・埋込・SharePointでは使用不可の理由を表示します。
