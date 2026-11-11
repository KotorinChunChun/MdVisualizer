# 検証ケースの入口

[検証手順](/docs/developer/testing/01-test-strategy.md)から、変更箇所に対応する既存テストを選ぶ。各テストの入力と期待結果を今回の要求と照合し、実行結果を版別の実装報告へ記録する。

- 印刷・PDF: [内部PDFの検証](/docs/developer/testing/03-internal-pdf.md)
- 文書比較・保存: [Diffの検証](/docs/developer/testing/04-document-diff.md)
- 編集操作のケース一覧: npm.cmd run report:editing -- --version v0.0.18（対象版を指定）

全機能に対する設計上のケース表は[テストケース設計](/docs/developer/testing/test-case-design.md)にまとめる。そこに項目があることを実装・実行・受入済みの根拠にしない。
