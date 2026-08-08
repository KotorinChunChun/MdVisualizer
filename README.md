# MarkdownViewer

Windows 向けの閲覧専用 Markdown ビューアです。複数の Markdown をタブで開き、画像クロップ、Mermaid、コード、表を軽快に表示します。

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

リリース版は `.md` と `.markdown` の関連付けを登録します。ファイルをダブルクリックすると、新しいプロセスで開きます。

## 主な機能

- Chrome ライクな複数タブ、ドラッグ並び替え、右クリック操作、閉じたタブの復元
- Markdownファイルのウィンドウ内ドロップ。同じファイルが既に開いている場合は既存タブを選択
- Markdown 内のローカル Markdown リンクをアプリ内の新しいタブで開く
- H1〜H6 のネスト折りたたみと、ファイル単位の状態保存
- 検索ボタン直隣の検索入力、複数結果を左側に表示する検索結果パネル（行番号・見出し階層・前後0〜5行の文脈・最大500件）と、正規表現・大小文字・前後移動。対応環境では Native Highlight、非対応環境では管理下の `mark` を使用
- 文書診断（欠落したローカルMarkdown／画像参照、同一文書の見出しアンカー、空の画像alt）と該当位置へのジャンプ
- `Ctrl+P`または「印刷/PDF」によるOS印刷。通常表示は連続ページ、プレゼンは1スライド1ページとして出力し、アプリの操作UIは印刷しない
- Markdown 内 HTML の許可リストサニタイズ、GFM 表、コピー可能なコードブロック
- Mermaid の遅延描画、テーマ反映、図／コード切替、コード・PNG・SVGコピー、fit／1:1／ホイール対応の拡大表示
- PNG・JPEG・GIF・WebP・SVG の表示と共通拡大プレビュー（SVG は表示のみで編集対象外）
- Shift_JIS / UTF-8 BOM / UTF-16 を含む文字コード検出とステータス表示
- ステータスバーまたはプレビュー上の `Ctrl` + マウスホイールで10%単位に変更できるテーマ、レイアウト、Auto Reload（ON / 手動のみ / OFF）、Mermaid、ズーム
- 見出し階層をページ化するプレゼンモード（再帰的な短文統合、パンくず、目次ツリー、前後移動、子見出し一覧、画像拡大）
- ステータスバー右端の歯車から開く設定タブと、外部アプリの追加・並び替え・表示場所変更
- 既定の「フォルダー」「VS Code」「別窓で開く」ボタンと、ツールバー高さを変えない独立ポップアップの「その他」メニュー
- 終了時のウィンドウ位置・サイズ保存と次回起動時の復元。別窓は起点ウィンドウと同じサイズで、右側を優先して配置
- 画像ホバー時の8方向ハンドルによる非破壊の表示縮小
- プレビューの2回目クリックから開く画像クロップ、透明／白／黒／自動色の余白追加、起動中のバックアップ復元
- `Alt+←`／`Alt+→` またはマウス第4／第5ボタンによる、タブ・プレゼンページ・メディアプレビューの履歴移動
- テーマ、表示モード、ズーム、Mermaid、Auto Reload の安全な永続化

## 検索・診断・印刷

`Ctrl+F` で検索を開きます。文脈行数は0〜5行で指定でき、結果一覧からEnterまたはクリックで該当箇所へ移動します。正規表現が不正な場合は入力欄に理由を表示します。

「診断」は現在文書内のローカル参照を検査します。診断は閲覧・印刷・外部アプリ起動を妨げず、一覧項目を選択すると本文位置へ移動します。外部URLは検査対象外です。

`Ctrl+P`または「印刷/PDF」からOSの印刷ダイアログを開けます。PDFはWindowsの **Microsoft Print to PDF** をプリンターに選んで保存してください。印刷ではライト配色を使い、タブ、目次、検索・診断パネル、操作ボタンは含めません。Mermaid描画中は最大5秒待機します。

通常レイアウトは連続ページ、プレゼンレイアウトは全スライドを1ページずつ出力します。ブラウザー／WebViewの印刷機能上、ページ番号などは印刷ダイアログ側の設定に従います。

目次の点灯は本文上のポインター位置を基準に更新します。ポインターを動かさずにスクロールしただけでは点灯項目は変わりません。

「別窓で開く」は現在のMarkdownを独立したアプリ内ウィンドウで開きます。起動中にエクスプローラーなどから別のMarkdownを開いた場合も、既存アプリ内に別窓として追加します。VS Codeで開く場合は、起動中の全VS Codeワークスペースを確認し、対象ファイルの親フォルダと完全一致するワークスペースがある場合だけそのウィンドウで開きます。一致を確認できない場合は、対象フォルダをワークスペースとする新しいVS Codeウィンドウを開きます。

## 表示確認用サンプル

`samples/` に機能別の Markdown を収録しています。主要記法をまとめて確認する場合は
`samples/all-markdown.md`、ローカル文書リンクは `samples/local-links.md`、Mermaid
各種は `samples/mermaid-gallery.md`、階層プレゼンは
`samples/presentation-hierarchy.md` を開いてください。

## ショートカット

| 操作 | キー |
| --- | --- |
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

Markdown 内の HTML は許可リストで処理し、イベント属性・任意 style・危険な URL スキームを除去します。外部リンクは HTTP(S) と `mailto:` のみを OS へ渡します。

設定は OS レベルのファイルロックを取り、一時ファイルを flush してから原子的に置換します。壊れた設定 JSON は日時付きで退避して既定値から起動します。
