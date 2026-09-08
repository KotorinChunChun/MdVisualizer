# MarkdownViewer 検証用サンプル目次

本ファイルは **MarkdownViewer** の検証用サンプルを開くための入口です。
リンクをクリックすると、各サンプルがMarkdownViewerの新しいタブで開きます。

---

## サンプル一覧

| サンプル | 主な確認内容 |
| :--- | :--- |
| [Markdown記法総合](all-markdown.md) | 見出し、文字装飾、リスト、表、コード、画像など |
| [画像大量表示](image-gallery.md) | 多数のPNG／SVG、連続画像、表・リスト内の画像 |
| [Mermaidギャラリー](mermaid-gallery.md) | Flowchart、Sequence、Class、エラー表示 |
| [ローカルMarkdownリンク](local-links.md) | 相対リンク、URLエンコード、外部リンク |
| [リンク先ドキュメント](linked-document.md) | ローカルリンクの遷移先とアンカー |
| [階層型プレゼン](presentation-hierarchy.md) | 見出し階層、パンくず、画像ポップアップ |
| [v0.0.5 UI・ウィンドウ連携](ui-workflow.md) | 検索、目次、倍率、別窓、VS Code連携 |
| [v0.0.5 Obsidian画像](obsidian-images.md) | Obsidian画像記法、画像一覧、altキャプション |
| [v0.0.6 Markdown／プレゼン印刷](markdown-presentation.md) | 引用、水平線、見出し罫線、印刷 |
| [v0.0.7 カスタマイズ](customization.md) | サイドパネル、配色、確認実行、印刷設定 |
| [Markdown Editor機能テスト](drawio_markdown_sample.md) | CSV／TSV、Mermaid、draw.io、SVG、Base64画像 |
| [v0.0.10 編集・図操作](v0.0.10-editing.md) | リスト操作、見出し採番、目次移動、Mermaid／draw.ioコピー |
| [サンプル集README](README.md) | 各ファイルの用途一覧 |

---

## このページでの基本動作確認

### 画像クロップテスト

下の画像をクリックすると、**画像クロップ編集モード** が起動します。  
ドラッグで範囲を指定し、**Enter (または適用ボタン)** で上書き保存、**Esc (またはキャンセルボタン)** で取り消すことができます。

![テスト用サンプル画像](images/sample.png)

---

### リアルタイム自動更新テスト

外部エディタ（VSCodeやメモ帳など）で本ファイルを変更・保存すると、MarkdownViewer 側が自動検知して即座にプレビューが更新されます。

- **自動リロード**: 保存時 300ms デバウンスで自動反映
- **F5リロード**: 手動での再読み込みも可能

---

### テスト用テーブル

| 機能 | 動作 | ステータス |
| :--- | :--- | :---: |
| リアルタイム自動更新 | 外部保存検知 | ✅ |
| 画像クロップ編集 | 8方向ハンドルドラッグ | ✅ |
| 一時バックアップ＆復元 | 「元に戻す」ボタン | ✅ |

---

### テスト用コードブロック

```typescript
// MarkdownViewer テストコード
function greet(name: string): string {
  return `Hello, ${name}! MarkdownViewer is running.`;
}
console.log(greet("Developer"));
```
