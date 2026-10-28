# Windows版のGitHub公開

2026-10-28着手、29日継続。利用者はリポジトリを公開へ変更し、Windows版をGitHubへリリースすることを承認済み。KotorinToysから署名付きMSIXを導入・管理できるようにする。

- [x] 0.0.19.3 betaへ進め、定義・管理応答・タイトル・MSIX版を一致させる。
- [x] Git履歴・配布物の秘密検査と共有Web子Gitの公開可否を確認する。
- [x] 既存の署名・ポータブル生成経路でWindows成果物を作り、署名・版・内容・ハッシュを検査する。
- [x] 関連回帰と隔離管理連携を検証してコミットする。
- [ ] 明示承認済みの公開設定変更・GitHub Release・匿名再取得を確認する。

Windows成果物とGitHub公開に限定し、SPFx・FTP配布サイト・利用者環境へのインストール・信頼登録は行わない。起動中の既存MSIXと利用者文書を保護する。

## 生成・検証結果

- frontend全回帰は同時実行数2で231ファイル・5,769件成功。初回はMermaid beforeAllの30秒期限で1ファイルが失敗しており、無制限並列時の結果と再実行結果を分けて保持した。production build成功（既知の大きいchunkの警告あり）。
- Rustは199件成功・既存の外部サービス試験2件ignore。release build成功。
- 署名MSIXは13,658,734 bytes、SHA-256 b642b57f9e3566d17ce1a4c60330f040b66fea2129b8a0adbdd7e6651f5859f0。共通証明書475BABC3C3D1E871D90503D45CC5236216D85EE8、既存Application Id MdVisualizerを維持。
- 実MSIXのWindows署名・Identity・全BlockMap・容量・SHA-256照合が成功。OPC ZIPの%40とBlockMapの@を本体で正規化する修正を実物で検証した。
- production EXEの隔離連携19件成功。通常起動・版・契約2・誤PID拒否・再表示・2画面・正常終了・設定分離・--startup拒否・最終画面終了後の非常駐を確認。利用者版・文書には操作しない。
- MdVisualizerと共有Web子Gitの全Git履歴検査は各0件。共有Web子Gitの公開設定は変更許可が未確定のため維持する。今回のWindowsバイナリ公開とは別に扱う。
- GitHub専用のガード付き公開スクリプトを追加。確認引数なしの実行拒否・PowerShell構文検査を確認。既存版上書き、main不一致、Identity・署名・ZIP内容の不一致を拒否する。
- 実OSでの新規MSIX導入・更新・削除、未信頼証明書の別PC、実画面での編集／未保存ダイアログは未受入。
