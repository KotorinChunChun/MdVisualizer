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
- H1〜H6 のネスト折りたたみと、ファイル単位の状態保存
- 検索（正規表現・大小文字・前後移動）。対応環境では Native Highlight、非対応環境では管理下の `mark` を使用
- Markdown 内 HTML の許可リストサニタイズ、GFM 表、コピー可能なコードブロック
- Mermaid の遅延描画、テーマ反映、コード fallback、拡大表示
- Shift_JIS / UTF-8 BOM / UTF-16 を含む文字コード検出とステータス表示
- ファイル変更の Auto Reload（ON / 手動のみ / OFF）、F5 再読み込み
- 画像クロップと起動中のバックアップ復元
- テーマ、表示モード、ズーム、Mermaid、Auto Reload の安全な永続化

## ショートカット

| 操作 | キー |
| --- | --- |
| 検索 | `Ctrl+F` |
| 検索を閉じる | `Esc` |
| 手動再読み込み | `F5` |
| 閉じたタブを復元 | `Ctrl+Shift+T` |
| 見出しをすべて折りたたむ | `Ctrl+Alt+T` |
| ズーム | `Ctrl` + `+` / `-` / `0` |
| 全画面 | `F11` |

## 検証

```powershell
npm test
npm run build
cargo test --manifest-path .\src-tauri\Cargo.toml
```

## セキュリティとデータ

Markdown 内の HTML は許可リストで処理し、イベント属性・任意 style・危険な URL スキームを除去します。外部リンクは HTTP(S) のみを OS ブラウザへ渡します。

設定は OS レベルのファイルロックを取り、一時ファイルを flush してから原子的に置換します。壊れた設定 JSON は日時付きで退避して既定値から起動します。
