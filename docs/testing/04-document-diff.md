# Diffの変更パターンと検証

更新日: 2026-09-13。対象はデスクトップ版ローカルMarkdownのDiff。SharePoint本文は既存の閲覧専用契約を維持する。

## 比較と保存の契約

- B: 最後に正常に読込／保存した基準本文とrevision・メタデータ。
- S: 最後に取得できたストレージ最新版。
- L: 3Way開始時に保持した自分の本文。採用しても書き換えない。
- R: 現在の編集結果。最初は自分の本文で、行採用・直接編集・Undo／Redoで変更する。

2WayはストレージSと採用結果R、3Wayは比較基準B・ストレージ最新版S・採用結果Rを表示する。自分の開始時本文Lは内部で保持し、行採用に使用する。閲覧のみはレンダリング結果を比較し、編集／閲覧は上にコード、下に対応するプレビューを表示する。上下は初期50:50、2列は左右50:50、3列は等分で、境界を変更できる。コード列はCodeMirrorを使用し、表示用の空行は保存本文へ追加しない。

矢印は対応する1行だけをRへ反映し、保存しない。外部変更に未選択が残る間、取得中、取得失敗、比較計算不能の間は採用・保存を禁止する。直接編集した行は手動判断として扱う。SとLとRが一致する行は選択不要。外部側が再更新された行は判断を無効にする。判断中の3WayはRがBと同じになっても自動再読込で破棄しない。

保存ボタンとCtrl+Sは同じ入口でレビュー対象の本文・基準revision・最新版revisionを照合し、既存の保存adapterへ確認済みrevisionを渡す。保存直前の再更新は既存Rustのrevision検査で拒否する。保存成功だけが新しい基準となり、保存中の追加入力は未保存のまま保持する。

この契約は今回のユーザー合意により、過去のv0.0.13要求26の採用時即時保存、およびモードごとに異なる旧Diff配置を置き換える。過去版の要求文書は履歴として保持する。

## データ変更パターン

| ID | パターン | 期待する動作 | 自動検証 |
| --- | --- | --- | --- |
| D01 | 未編集、外部変更、Auto Reload ON | 本文・B・revision・encoding等を同時更新し2Way継続 | storage refresh |
| D02 | 編集中の2Wayで外部変更 | BとRを保持し全3表示モードで3Wayへ | refresh、component |
| D03 | Auto Reload OFF／手動 | Sだけ更新、Rは置換しない | refresh |
| D04 | Diffを開く | Sを取得するだけでRを置換しない | refresh |
| D05 | 本文は同じでrevisionだけ更新 | 正常自動読込で基準情報を更新 | refresh |
| D06 | 取得中に入力 | 自動置換を中止し入力を保持 | refresh |
| D07 | 取得中に入力してUndo | 本文が元に戻っていても入力世代で保護 | refresh |
| D08 | 取得中に添付追加 | ステージ中の添付とドラフトを保持 | refresh、reducer |
| D09 | 明示再読込中に入力 | 新しい入力を残しSだけ取得 | refresh |
| D10 | 外部更新の応答順が逆転 | 古い応答で巻き戻さない | refresh |
| D11 | 保存後に古い読込応答 | 保存した基準を上書きしない | refresh |
| D12 | 保存中に追加入力、直後に外部更新 | Bを保存結果へ更新し、追加入力と新しいSを保持 | refresh、reducer |
| D13 | 削除・権限不足・取得失敗 | 本文保持、理由表示、採用・保存禁止 | refresh、component |
| D14 | 削除通知後に古い取得成功 | 削除状態を旧応答で消さない | refresh |
| D15 | 取得中にタブを閉じる／別タブへ | 他タブに旧応答を適用しない | refresh、save guard |
| D16 | 異なる行の編集／同じ行の競合 | 指定1行だけ採用、他の自分の変更を保持 | merge、component |
| D17 | 両者が同じ変更 | 一致行を未選択にしない | merge |
| D18 | 行の追加・削除・置換・行数差 | 本文を欠落させず対応空間と採用先を一致 | merge、headless |
| D19 | 空文書・末尾改行・CRLF・CR・日本語 | 先頭／末尾の採用で重複や不要改行を生じない | merge、headless |
| D20 | 反復行を含むseed固定100組 | 両側200通りの行採用がそれぞれ原文へ到達 | merge |
| D21 | ストレージを採用後、自分を採用 | Lを保持して戻せる。採用だけでは保存しない | component、headless |
| D22 | 採用／直接編集のUndo・Redo | 本文と判断状態を一緒に復元 | component |
| D23 | 判断後にSが再更新 | 結果とLを保持し、影響行を未選択へ戻す | component |
| D24 | 3Way→2Way→再度3Way | 新たな3Way開始時の自分の本文をLへ保持 | component |
| D25 | 未選択／古いレビュー／取得中に保存 | 全保存入口で拒否 | save guard |
| D26 | 保存直前にストレージ再更新 | revision不一致で元データを上書きしない | save guard、既存Rust document_edit |
| D27 | 3WayでR=Bを選んだ後に重複通知 | dirty=falseでも判断中のRとBを保持 | refresh、save guard |
| D28 | 2万行の局所変更 | 一括置換へ粗くせず変更1行を抽出 | merge |
| D29 | 390／768／1440px、明暗、100／200% | 全列の書式とコード行・矢印の実座標一致 | headless |
| D30 | 先頭・途中・末尾スクロール、採用後 | 対応行が同じ高さを維持 | headless |
| D31 | 差分計算が上限超過、その後に手入力／Undo | 本文を保持し、比較不能を空差分の成功扱いにしない | merge hook |

## 実行方法

```powershell
npm.cmd test -- src/lib/documentStorageRefresh.test.ts src/lib/documentMerge.test.ts src/lib/documentDiffSave.test.ts src/hooks/useDocumentMerge.test.tsx src/components/DocumentDiffWorkspace.test.tsx src/state/tabsReducer.test.ts src/App.test.ts --maxWorkers=4
npm.cmd run test:diff-layout
cargo test --manifest-path src-tauri/Cargo.toml document_edit::tests
npm.cmd test -- --maxWorkers=4
npm.cmd run build
```

`test:diff-layout`は既存Edgeの新規隔離headlessプロセスを使う。既存ブラウザー、既存プロファイル、OS入力、実アプリは操作しない。通信はlocalhostのfixtureだけを許可する。Edgeがないrunnerでは`DIFF_BROWSER_PATH`へ検証用Chromium系ブラウザーの絶対パスを指定する。Playwrightは開発依存であり製品bundleへ含めない。

12構成それぞれで2Way、3Way、途中、末尾、採用後、空文書の6時点を測定する。生成した`tmp/diff-layout/<実行時刻>/report.json`へブラウザー版、測定件数、書式、scroll位置、失敗理由を保存する。生成物はGit管理しない。測定はDOM座標の検査であり、目視受入ではない。

## 制約と別環境での受入

- 実GUI／WebView2／ファイル監視のOS通知から画面への経路、実際のキーボードTab移動、フォント描画の目視確認は実画面受入として記録する。当該PCの禁止は2026-09-13に解除済み。
- 変更が非常に多く安全な行対応の計算上限を超えた場合、本文を保持し、行採用・保存を停止して理由を表示する。粗い一括置換で代用しない。
- Undo／RedoはDiffを開いている間の直近200操作。基準の正常再読込／保存とDiff終了で履歴はリセットする。Diffを閉じても採用済みのドラフトはタブに残る。
- SharePoint本文編集、SPFxへの同一UI導入、実アプリの印刷／CubePDF受入は今回の検証対象ではない。
