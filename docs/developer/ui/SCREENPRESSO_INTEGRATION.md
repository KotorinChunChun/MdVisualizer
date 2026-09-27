# 画像注釈HTMLの統合

`web-platform/packages/editor-ui/src/assets/screenpresso.html`がユーザー提供HTMLの保存原本です。SHA-256は`B2761C48EDCCD297FF6916507EE1AFE1BA1BFBC8DE4000483E0A89C37F0B5F80`。原本へホスト固有処理を直接書き込まず、`screenpressoHost.ts`でCSPと通信処理を付加します。

DesktopのAppとWebImageEditorは共通のImageEditingDialogを呼び出します。PNG/JPEGは新旧を選択し、それ以外は従来のImageAnnotationEditorへ渡します。SPFxに編集起動経路は追加していません。操作方法は[画像編集](/docs/user/ui/image-editing.md)を参照してください。

## 隔離と保存契約

iframeは`allow-scripts allow-modals allow-downloads`のみ許可し、same-originを付けません。CSPで外部通信・フォーム送信・外部スクリプトを禁止し、画像はdata/blobのみ許可します。親側が画像をPNG化して送り、HTML側が注釈を合成してPNGを返します。送信元Window・通信チャネル・起動ごとの識別子・保存要求IDを確認し、未要求・重複・別画面からの結果を受理しません。

親の「反映」は既存のsaveRenderedImageまたは埋込／SharePoint／WebのonApplyへ渡します。外部保存は既存のファイルロック・バックアップ・原子的置換と寸法確認を使用し、追加で画像versionの変化を反映前に照合します。同寸法の外部更新をファイル内容ハッシュで原子的に検出する仕組みは既存APIにはなく、version通知での検出範囲に留まります。

JPEGへ保存する場合はRGBAを白背景へ合成してからエンコードします。保存失敗時は元ファイルと編集画面を保持します。PNG応答の形式と署名を確認し、保存要求には15秒の応答待ち上限を設けています。Tauri保存開始後はその処理結果を待ちます。

元画像の読込み・HTMLの起動は新エディター選択時に行います。旧エディターの内部実装は維持します。親srcへのHTMLを含む投影はsource-mapで管理し、UIインベントリーでは投影を二重に数えません。

## 検証

- `npm.cmd test -- src/components/ScreenpressoEditor.test.tsx src/components/ImageAnnotationEditor.test.tsx src/App.test.ts`
- `node --test tests/web-image-editor.test.mjs tests/screenpresso-editor.test.mjs`
- `cargo test --manifest-path src-tauri/Cargo.toml image_ops::tests`
- `npm.cmd run check:shared`、`npm.cmd run check:ui-contract`、frontend／debugビルド。

ブラウザー試験はPNG/JPEGの読込み・実マウスでの注釈描画・出力画素の変化・キャンセル・従来画面を検証します。Windows実画面受入では試験文書だけを使い、元ファイル形式、バックアップ、キャンセル時のハッシュ不変を確認します。性能比較は[性能回帰測定](/docs/developer/testing/06-performance-regression.md)の基準整備状況と分けて記録します。
