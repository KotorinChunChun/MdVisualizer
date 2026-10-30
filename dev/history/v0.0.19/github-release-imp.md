# Windows版のGitHub公開

2026-10-28着手、29日継続。利用者はリポジトリを公開へ変更し、Windows版をGitHubへリリースすることを承認済み。KotorinToysから署名付きMSIXを導入・管理できるようにする。

- [x] 0.0.19.3 betaへ進め、定義・管理応答・タイトル・MSIX版を一致させる。
- [x] Git履歴・配布物の秘密検査と共有Web子Gitの公開可否を確認する。
- [x] 既存の署名・ポータブル生成経路でWindows成果物を作り、署名・版・内容・ハッシュを検査する。
- [x] 関連回帰と隔離管理連携を検証してコミットする。
- [x] 明示承認済みの公開設定変更・GitHub Release・匿名再取得を確認する。

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

## 公開結果

- リポジトリをpublicへ変更し、採用35cc36bをmainへfast-forwardで反映。v0.0.19.3のGitHub prereleaseを公開した。
- 公開先：https://github.com/KotorinChunChun/MdVisualizer/releases/tag/v0.0.19.3
- MSIX、ZIP、公開CER、SHA256SUMSを認証なしで再取得し、全SHA-256一致。MSIX 13,658,734 bytes、ZIP 13,280,538 bytes、CER 1,032 bytes。
- MSIX配布入力100ファイルの秘密検査0件。コミット後の全Git履歴検査も完了して0件。Web子Gitの公開設定は変更していない。
- GitHub公開スクリプトのWhatIf事前検査・本実行とも成功。SPFx、FTP、既存インストール、証明書信頼登録は変更していない。

## 2026-10-30 0.0.19.4 betaのWindows更新

ユーザーの「リリースしてください」により、このチャットで継続しているGitHub Windows配布を更新する。採用3bb6c30、共有Web b12677b。HTTPS Wiki Markdownの選択、受信URL診断・コピー、ショートカット表示・キー、白文字エラー、GUI検証分割を含む。SPFx・FTP配布先・導入済みアプリ・証明書信頼は今回変更しない。

- [x] P1：既存更新スクリプトで0.0.19.4へ進め、定義と公開ノートを揃える。全回帰の前回結果と今回差分を照合し、関連試験・リリース安全性・production生成を検証する。
- [x] P2：固定証明書で署名したMSIXと許可リストZIPを検証し、秘密検査・採用ソースをコミット。既存ガード付きGitHub公開処理のWhatIfを確認する。
- [ ] P3：採用ソースを公開mainへ反映して新規prereleaseを公開。匿名再取得のハッシュを照合し、KotorinToysの一覧・取得情報を更新する。

前回の最終機能ソースb8f6097でfrontend5,779件・Rust208件が成功し、実画面の受信・コピー・Ctrl+O・設定保存・文字色も確認済み。その後は検証基盤と資料のみを変更し、22件の自己試験が成功した。版番号だけを変更した今回のソースで無条件に全frontendを再実行せず、関連試験、版整合、実production成果物の検証を追加する。未確認の実テナント取得と録画不良の記録を維持する。

P1結果：関連frontend4ファイル32件、共有投影、増分型検査、公開安全性／版更新の自己検証、GUI基盤22件が成功。Rust初回は207成功・タイトルの旧版固定1失敗・2ignoredだった。タイトル試験を配布設定との照合へ修正し、最終208成功・2ignoredを確認した。版以外の製品動作コードは変えていない。既存MSIX生成入口でproduction build・固定証明書署名に成功し、単独EXEのZIPも生成した。大きいchunk等の既知警告あり。各工程の時刻・所要時間・初回失敗をlogs/github-release-20261030/へ保存した。
P2結果：実MSIX 13,730,092 bytes、SHA-256 98365741e781e9adcbb317efbe7dc6206d4729ec5d766f7362605a23984faffd。ZIP 13,345,162 bytes、SHA-256 474d92f046be54ea3bb0a1073305fa05610b44f61410075919fb431cc43a555c。固定署名者・Identity・全BlockMap・ハッシュをKotorinToysの実検証器でも照合した。専用設定とコピーした同一ハッシュEXEで管理連携19件成功し、非常駐・無表示起動拒否・正常終了を確認。KotorinToysのMSIX関連97件も成功した。配布入力100ファイル、前回公開main以降の採用差分と共有子の採用差分の秘密検査はすべて検出0件。KotorinToys側の生ログはv0.1.16/logs/md-release-20261030/に保存。

共有Webの既存mainは別系列の変更を含み、採用b12677bを含まないため上書きしない。非公開のまま今回の採用ソースを専用参照へ保存する。公開ノートへ修正点と実テナント・実MSIX導入の未受入を明記した。