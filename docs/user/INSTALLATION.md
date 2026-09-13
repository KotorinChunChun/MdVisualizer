# インストールと起動

対象はWindows 10 2004以降のx64環境です。WebView2 Runtimeが必要です。

## beta版ダウンロード

配布物は[配布ページ](https://excel-chunchun.sakura.ne.jp/download/MdVisualizer.html)で確認してください。

公開後は初回インストール用のApp Installer、MSIX、自己署名証明書を取得できます。自己署名証明書を
「信頼されたユーザー」へ登録してからApp Installerを開いてください。導入後はアプリ起動時に
betaチャネルの更新を確認します。

v0.0.16から名称と内部識別子を変更し、旧MarkdownViewerとは別アプリとして導入します。旧版の設定・認証情報を自動移行せず、新版で設定とサインインを行います。旧版の保存領域は削除しません。

## 文書を開く

アプリへMarkdownファイルをドロップするか、Windowsの「プログラムから開く」でMdVisualizerを選びます。関連付け対象は.md、.markdown、.svg、.mmd、.mermaid、.drawio、.tsvです。編集可能な範囲や操作は[利用ガイド](/docs/USERS_GUIDE.md)を参照してください。
