# MarkdownViewer

Windows 向けの閲覧専用 Markdown ビューアです。複数の Markdown をタブで開き、画像クロップ、Mermaid、コード、表を軽快に表示します。

## 起動

開発時は次でサンプルを開きます。

```powershell
pwsh .\dev\scripts\run-test.ps1
```

または、Markdown ファイルを引数に渡します。

```powershell
npm run tauri dev -- C:\Project\README.md C:\Project\design.markdown
```

リリース版は `.md` と `.markdown` の関連付けを登録します。ファイルをダブルクリックすると、新しいプロセスで開きます。

## 主な機能

- Chrome ライクな複数タブ、ドラッグ並び替え、右クリック操作、閉じたタブの復元
- Markdownファイルのウィンドウ内ドロップ。同じファイルが既に開いている場合は既存タブを選択
- Markdown 内のローカル Markdown リンクをアプリ内の新しいタブで開く
- H1〜H6 のネスト折りたたみと、ファイル単位の状態保存
- 検索（正規表現・大小文字・前後移動）。対応環境では Native Highlight、非対応環境では管理下の `mark` を使用
- Markdown 内 HTML の許可リストサニタイズ、GFM 表、コピー可能なコードブロック
- Mermaid の遅延描画、テーマ反映、図／コード切替、コード・PNG・SVGコピー、fit／1:1／ホイール対応の拡大表示
- PNG・JPEG・GIF・WebP・SVG の表示と共通拡大プレビュー（SVG は表示のみで編集対象外）
- Shift_JIS / UTF-8 BOM / UTF-16 を含む文字コード検出とステータス表示
- ステータスバーから変更できるテーマ、レイアウト、Auto Reload（ON / 手動のみ / OFF）、Mermaid、ズーム
- 見出し階層をページ化するプレゼンモード（再帰的な短文統合、パンくず、目次ツリー、前後移動、子見出し一覧、画像拡大）
- ステータスバー右端の歯車から開く設定タブと、外部アプリの追加・並び替え・表示場所変更
- 既定の「フォルダー」「VS Code」ボタンと、メモ帳を含む「その他」サブメニュー
- 画像ホバー時の8方向ハンドルによる非破壊の表示縮小
- プレビューの2回目クリックから開く画像クロップ、透明／白／黒／自動色の余白追加、起動中のバックアップ復元
- `Alt+←`／`Alt+→` またはマウス第4／第5ボタンによる、タブ・プレゼンページ・メディアプレビューの履歴移動
- テーマ、表示モード、ズーム、Mermaid、Auto Reload の安全な永続化

## 表示確認用サンプル

`samples/` に機能別の Markdown を収録しています。主要記法をまとめて確認する場合は
`samples/all-markdown.md`、ローカル文書リンクは `samples/local-links.md`、Mermaid
各種は `samples/mermaid-gallery.md`、階層プレゼンは
`samples/presentation-hierarchy.md` を開いてください。

## ショートカット

| 操作 | キー |
| --- | --- |
| 検索 | `Ctrl+F` |
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
