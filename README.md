# MarkdownViewer

Windows向けのMarkdownビューア／エディターです。複数の文書をタブで開き、ローカルMarkdownの編集・安全な保存に加えて、画像、Mermaid、draw.io、コード、対話型CSV／TSV表を表示できます。

## beta版ダウンロード

[MarkdownViewer v0.0.7-beta ダウンロード](https://excel-chunchun.sakura.ne.jp/download/MakdownViewer.html)から、
初回インストール用のApp Installer、MSIX、自己署名証明書を取得できます。自己署名証明書を
「信頼されたユーザー」へ登録してからApp Installerを開いてください。導入後はアプリ起動時に
betaチャネルの更新を確認します。

## 起動

### Windows の初回セットアップ

開発モードで起動するには、次の開発環境が必要です。

- Node.js LTS（`node` と `npm`）
- Rustup（`cargo` と `rustc`）
- Visual Studio Build Tools の「Desktop development with C++」（Rust の Windows 向けビルドで必要になる場合があります）

Node.js と Rustup の導入後は PowerShell を開き直し、次のコマンドで確認してください。

```powershell
node --version
cargo --version
```

PowerShell の実行ポリシーによって `npm.ps1` がブロックされる環境では、`npm` の代わりに `npm.cmd` を使用します。

```powershell
Set-Location C:\develop\MarkdownViewer
npm.cmd install
```

`npm.cmd` は Windows のコマンド版ランチャーであり、実行ポリシーを変更せずに使用できます。

開発時は次でサンプルを開きます。

```powershell
npm.cmd run tauri -- dev -- -- C:\develop\MarkdownViewer\samples\sample.md
```

または、Markdown ファイルを引数に渡します。

```powershell
npm.cmd run tauri -- dev -- -- C:\Project\README.md C:\Project\design.markdown
```

開発中のアプリは `http://localhost:1420` のViteサーバーを表示します。起動したPowerShellを終了するとサーバーも停止するため、アプリには接続拒否画面が表示されます。`src-tauri\target\debug\markdown-viewer.exe` を単独で起動するのではなく、上記コマンドから起動してください。

リリース版は `.md`、`.markdown`、`.svg`、`.mmd`、`.mermaid` の関連付けを登録します。ファイルをダブルクリックすると、Markdown、SVG、Mermaid文書として開きます。

### SharePoint Markdown（spmd）

インストール版は`spmd:`プロトコルを登録し、SharePoint OnlineのドキュメントライブラリにあるMarkdownを開けます。

```text
spmd://excelchunchun.sharepoint.com/sites/msteams_fcce9d/Shared%20Documents/md/README.md
```

アプリケーションIDとマルチテナント設定はMarkdownViewerに組み込み済みです。利用者がMicrosoft EntraのテナントIDやアプリケーションIDを設定する必要はありません。

初回アクセス時は既定ブラウザーにMicrosoftのサインインページを開き、MarkdownViewerに表示されたデバイスコードを入力して、所属組織のMicrosoftアカウントで認証します。外部テナントのユーザーも利用できますが、所属組織の同意ポリシーによっては管理者による承認が必要です。アクセストークンはアプリのプロセス内だけに保持し、更新トークンはWindows資格情報マネージャーへ保存します。

`spmd:` URIにはアクセストークン、共有トークン、クエリ文字列を含めないでください。SharePoint文書では再読み込み、印刷、別窓、同じSharePoint内の相対Markdownリンクを使用できます。同じサイトかつ同じドキュメントライブラリ内の相対PNG／SVGは認証付きで表示でき、拡大表示の「画像編集」から元画像へ保存できます。SharePoint Markdown本文、ローカルファイル監視、診断、外部エディターは対象外です。

初回サインインで取得した更新トークンはWindows資格情報マネージャーへ暗号化保存し、次回起動以降のアクセストークン更新に使用します。アプリ側では保存期限を設けませんが、Microsoftアカウントのパスワード変更、管理者ポリシー、同意取消しなどで更新トークンが失効した場合は再サインインが必要です。

### MSIXインストーラー

Windows SDKが導入済みのx64 Windows環境では、次のコマンドで署名済みMSIXを生成できます。

```powershell
npm.cmd run build:msix
```

成果物は`release\msix`へ出力されます。既定では自己署名の開発用証明書を使用するため、証明書の内容を
確認し、検証端末の現在ユーザーだけで信頼してから導入します。

```powershell
pwsh -NoProfile -File .\scripts\install-msix.ps1 -TrustDevelopmentCertificate
```

本番配布では信頼されたコード署名PFXとタイムスタンプURLを指定してください。詳しい生成・署名・導入手順と
制約は`packaging/msix/README.md`に記載しています。対象はWindows 10 2004以降のx64環境で、WebView2 Runtimeが必要です。

## 主な機能

- ローカルMarkdownを「編集のみ」「編集／閲覧」「閲覧のみ」で切り替え。編集中のライブプレビュー、Markdownツールバー、構文強調、折りたたみ、`Ctrl+S`保存
- UTF-8 BOM、UTF-16、Shift_JIS等の文字コードと改行形式を可能な限り維持し、外部更新との競合、再読み込み、タブ／ウィンドウ終了から未保存内容を保護
- Chrome ライクな複数タブ、ドラッグ並び替え、右クリック操作、閉じたタブの復元
- Markdownファイルのウィンドウ内ドロップ。同じファイルが既に開いている場合は既存タブを選択
- `spmd:`からSharePoint OnlineのMarkdownをMicrosoft Graph経由で閲覧し、同じライブラリ内の相対Markdownリンクを開く
- Markdown 内のローカル Markdown リンクをアプリ内の新しいタブで開く
- H1〜H6 のネスト折りたたみと、ファイル単位の状態保存。`Ctrl+Alt+T`はH1を残してH2以下を一括開閉
- 目次・検索・画像を切り替える単一サイドパネル。検索入力、条件、前後移動、結果一覧（最大500件・一致文字強調）を検索タブに集約し、画像タブはaltとサムネイルから本文へジャンプ
- 文書診断（欠落したローカルMarkdown／画像参照、同一文書の見出しアンカー、空の画像alt）と該当位置へのジャンプ
- `Ctrl+P`または「印刷/PDF」によるOS印刷。通常表示は連続ページ、プレゼンは1スライド1ページとして出力し、アプリの操作UIは印刷しない
- Markdown 内 HTML の許可リストサニタイズ、入れ子引用、水平線、GFM 表、コピー可能なコードブロック。PowerShell系フェンスは確認後に限り30秒・出力1MiB制限で実行
- `csv`、`tsv`、`csv-h`、`tsv-h`コードフェンスの検索、並べ替え、列表示、ページング、コピー、CSV出力、印刷、表編集。SearchPanesは初期OFF
- Mermaid の遅延描画、テーマ反映、図／コード切替、コード・PNG・SVGコピー、fit／1:1／ホイール対応の拡大表示
- `drawio`コードフェンスの表示、新規作成、再編集。SVG／Mermaidからdraw.io図への変換
- PNG・JPEG・GIF・WebP・BMP・SVGの表示と共通拡大プレビュー。Markdown内のラスタ画像とSVGを埋め込み／同フォルダの別ファイルへ相互変換
- 外部画像とBase64画像の注釈編集、自由描画、消去、塗りつぶし、スポイト、図形、文字、切り抜き、回転、反転、サイズ変更、Undo／Redo
- Shift_JIS / UTF-8 BOM / UTF-16 を含む文字コード検出とステータス表示
- ステータスバーまたはプレビュー上の `Ctrl` + マウスホイールで10%単位に変更できるテーマ、Auto／A4縦／A3縦レイアウト、Auto Reload（ON / 手動のみ / OFF）、Mermaid、ズーム
- 見出し階層をページ化するプレゼンモード（再帰的な短文統合、パンくず、目次ツリー、前後移動、子見出し一覧、画像拡大）
- ステータスバー右端の歯車から開く設定タブと、外部アプリ、シンタックス配色、印刷色・フォント・白黒モードの設定
- 既定の「フォルダー」「VS Code」「別窓で開く」ボタンと、ツールバー高さを変えない独立ポップアップの「その他」メニュー
- 終了時のウィンドウ位置・サイズ保存と次回起動時の復元。別窓は起点ウィンドウと同じサイズで、右側を優先して配置
- 画像ホバー時の8方向ハンドルによる非破壊の表示縮小
- Obsidian形式の`![[画像]]`／`[[画像]]`プレビューと`|代替テキスト`キャプション
- プレビューの2回目クリックから開く画像クロップ、透明／白／黒／自動色の余白追加、起動中のバックアップ復元
- `Alt+←`／`Alt+→` またはマウス第4／第5ボタンによる、タブ・プレゼンページ・メディアプレビューの履歴移動
- テーマ、表示モード、ズーム、Mermaid、Auto Reload の安全な永続化

## Markdown編集

ローカルMarkdownを開くと、ツールバーの「編集のみ」「編集／閲覧」「閲覧のみ」で画面を切り替えられます。起動時と文書を開いた直後は「閲覧のみ」です。「編集／閲覧」では、保存前のドラフトを右側のプレビューへ即時反映します。

保存は画面内の保存ボタンまたは`Ctrl+S`で行います。タブ名の`*`は未保存状態です。読込み後に外部アプリが元ファイルを更新していた場合は上書きを拒否します。未保存のまま再読み込み、タブ終了、ウィンドウ終了を行う場合は確認を表示します。SharePoint Markdown本文、単体SVG、単体Mermaidは閲覧専用です。SharePoint Markdownから参照する相対PNG／SVGは画像本体だけを編集できます。

Markdown編集ツールバーから、見出し、文字装飾、引用、各種リスト、リンク、コード、表、Mermaid、水平線、画像、draw.io図を挿入できます。CSV／TSV表、Markdown内の画像・SVG、draw.io図はプレビュー側の編集操作から、選択した箇所だけをドラフトへ反映します。

## 検索・診断・印刷

`Ctrl+F` で検索を開きます。すでに開いている場合も入力欄へ戻り、現在の検索語を全選択します。文脈行数は0〜5行で指定でき、結果一覧からEnterまたはクリックで該当箇所へ移動します。正規表現が不正な場合は入力欄に理由を表示します。

「診断」は現在文書内のローカル参照を検査します。診断は閲覧・印刷・外部アプリ起動を妨げず、一覧項目を選択すると本文位置へ移動します。外部URLは検査対象外です。

`Ctrl+P`または「印刷/PDF」からOSの印刷ダイアログを開けます。PDFはWindowsの **Microsoft Print to PDF** をプリンターに選んで保存してください。印刷ではライト配色を使い、タブ、目次、検索・診断パネル、操作ボタンは含めません。Mermaid描画中は最大5秒待機します。

通常レイアウトは連続ページ、プレゼンレイアウトは下位見出し一覧を含む全スライドを1ページずつ出力します。ブラウザー／WebViewの印刷機能上、ページ番号などは印刷ダイアログ側の設定に従います。

本文レイアウトは利用可能幅へ合わせる「オート」、210mm相当へ固定する「A4縦」、297mm相当へ固定する「A3縦」から選択できます。固定幅がウィンドウを超える場合は縮小せず横スクロールします。目次・検索・画像の単一パネルは860px以上で本文左の常設sidecar、859px以下でdrawerになります。

目次の点灯は本文上のポインター位置を基準に更新します。ポインターを動かさずにスクロールしただけでは点灯項目は変わりません。

「別窓で開く」は現在のMarkdownを独立したアプリ内ウィンドウで開きます。起動中にエクスプローラーなどから別のMarkdownを開いた場合も、既存アプリ内に別窓として追加します。VS Codeで開く場合は、起動中の全VS Codeワークスペースを確認し、対象ファイルを配下に含むフォルダまたはマルチルートワークスペースがあればそのウィンドウで開きます。複数該当時は最も深いルートを優先します。該当がない場合は上位フォルダを探索し、`.code-workspace`、`.git`、`.vscode`、主要なプロジェクト定義、`.claude`／`AGENTS.md`を手掛かりに推定したワークスペースを新しいVS Codeウィンドウで開きます。

Obsidian画像は`![[images/photo.png]]`と`[[images/photo.png]]`の両方を表示できます。`![[images/photo.png|説明]]`のように指定した説明は画像下のキャプションとして表示します。画像拡張子を持たない通常のWikiリンクは画像へ変換しません。

## 表示確認用サンプル

`samples/` に機能別の Markdown を収録しています。主要記法をまとめて確認する場合は
`samples/all-markdown.md`、ローカル文書リンクは `samples/local-links.md`、Mermaid
各種は `samples/mermaid-gallery.md`、階層プレゼンは
`samples/presentation-hierarchy.md` を開いてください。v0.0.5で追加した検索・目次・倍率・別窓・VS Code連携は
`samples/ui-workflow.md`、Obsidian画像とalt配置は`samples/obsidian-images.md`で確認できます。v0.0.6の引用・印刷表示は`samples/markdown-presentation.md`、v0.0.7の単一パネル・コード配色・PowerShell確認実行・印刷設定は`samples/customization.md`で確認できます。
v0.0.9の編集モード、CSV／TSV、draw.io、Base64画像は`dev/drawio_markdown_sample.md`で確認できます。

## ショートカット

ステータスバーの`？`ボタンまたは`Ctrl+?`でショートカット一覧を開けます。ページ下部には更新日、
アプリバージョン、作者、GitHub README／リリースへのリンクを表示します。

| 操作 | キー |
| --- | --- |
| 編集中のローカルMarkdownを保存 | `Ctrl+S` |
| 検索 | `Ctrl+F` |
| 印刷／PDF | `Ctrl+P` |
| 検索を閉じる | `Esc` |
| 手動再読み込み | `F5` |
| 現在のタブを閉じる | `Ctrl+W` |
| 閉じたタブを復元 | `Ctrl+Shift+T` |
| 次／前のタブへ移動 | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| 見出しの全展開／全折りたたみを切り替える | `Ctrl+Alt+T` |
| ズーム | `Ctrl` + `+` / `-` / `0` |
| 全画面 | `F11` |
| プレゼンの前／次ページ | `←` / `→` |
| 操作履歴を戻る／進む | `Alt+←` / `Alt+→`、マウス第4／第5ボタン |

## 検証

```powershell
npm test
npm run build
cargo test --manifest-path .\src-tauri\Cargo.toml
npm run tauri build
```

### 性能測定

release EXEで10,000行のMarkdownを5回起動した測定では、起動時間の中央値は41ms、初回を含む最大は493ms、ワーキングセット最大は24.1MBでした。再測定には `dev/scripts/measure-performance.ps1` を使用します。

## セキュリティとデータ

Markdown 内の HTML は許可リストで処理し、イベント属性・任意 style・危険な URL スキームを除去します。外部リンクは HTTP(S) と `mailto:` のみを OS へ渡します。`spmd:`はMarkdownViewer内の文書移動としてだけ処理し、SharePoint Onlineのホスト、`/sites/`または`/teams/`パス、Markdown拡張子をRust側でも検証します。

PowerShellコードは`powershell`、`pwsh`、`ps1`と明示されたフェンスだけが対象です。コードと作業フォルダーを表示する確認操作なしには実行せず、Markdown所在フォルダー固定、非対話、30秒、入力256KiB、出力1MiBの上限をbackendでも検証します。

設定は OS レベルのファイルロックを取り、一時ファイルを flush してから原子的に置換します。壊れた設定 JSON は日時付きで退避して既定値から起動します。
