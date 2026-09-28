# 性能回帰測定

## 固定入力と区間

`/samples/v0.0.18.4-100-embedded-images.md`を使う。生成元は`/scripts/generate-embedded-image-load-fixture.mjs`で、100枚の500×500 PNGをdata URLとして含む。本文hash・画像件数・自然寸法を照合し、0枚、壊れた画像、空ページを正常測定にしない。

Desktopの計測は専用fixtureタブだけに対して行う。利用者の文書や未保存本文を測定用に書き換えない。エディター内の本文hashがfixtureと異なれば中止する。編集計測は試験文書の先頭へ一時文字列を挿入し、プレビュー反映後に元の本文へ戻す。ファイル保存は行わない。

| 指標 | 測定区間 |
|---|---|
| `loadMs` | 分割プレビュー表示操作後から100枚のdecode完了と次のrAFまで。ウォーム再表示であり、ディスク読込全体やコールド起動の時間ではない |
| `editMs` | 試験文字列のCodeMirror挿入からプレビューへの文字列出現と次のrAFまで |
| `syncMs` | コード末尾へカーソルを移動してからプレビュー末尾へのスクロールと次のrAFまで |
| `scrollSweepMs` | 41回のrAFを使い先頭→末尾→先頭へスクロールする時間 |
| `maxFrameMs` | 上記スクロール中の最大rAF間隔 |

rAFは描画完了や体感の証明そのものではない。最終受入では実画面、画像の表示、コード・プレビュー連動も確認する。初回読込を調べる場合はファイル選択直前から100枚のdecode完了までを別に測り、ウォーム再表示の基準と混ぜない。

## 実行方法

専用デバッグ版をリモートデバッグポート9333で起動し、fixtureを開いてから実行する。未保存の利用者文書がある既存プロセスを測定のために再起動しない。倍率は100%、同じウィンドウサイズ・左右分割で揃える。

```powershell
node scripts/embedded-image-performance.test.mjs
node scripts/test-embedded-image-load.mjs 9333 dev/history/v0.0.19/logs/embedded-images-run1 --version=v0.0.19 --build-kind=acceptance-debug --trials=5
```

ページが複数ある場合は`--target=<CDP target id>`で一意に指定する。`--fixture=<path>`、`--baseline=<path>`で入力と基準の場所を指定できる。デフォルトの基準は`tests/performance/baselines/embedded-images-load.json`。

基準がまだない場合、測定だけを記録するには`--measure-only`を指定する。この結果は`measured-not-compared`であり、回帰合格を意味しない。通常実行では基準欠落・測定無効・条件不一致・回帰を終了コード1とする。

有効な測定と環境を確認し、基準更新が明示的に認められた場合だけ`--update-baseline`を使う。自動更新や失敗した測定での上書きはしない。旧形式の基準は新形式へ自動変換せず拒否する。

## 自己テストと記録

測定器はCDPの`result.value`を取得し、評価例外を失敗として扱う。接続・各応答のタイムアウト、途中切断時の待機解放、終了時のWebSocket切断を行う。自己テストは無効値、画像件数・寸法違い、CDP例外、接続／応答タイムアウト、途中切断、基準の欠落・条件不一致、意図的な遅延による回帰検出を確認する。

ウォームアップ1回を除き、3〜20回（既定5回）を実測する。`summary.json`には各試行、中央値、p95、最大値、入力SHA-256、ブラウザー版、OS・CPU、viewport/DPR、ビルド種別、Git revision・未コミット有無、日時を記録する。結果は対象版の`dev/history/vX.Y.Z/logs/`へ置く。

## 回帰判定

入力hash、ブラウザー版、OS・CPU、ビルド種別、viewport/DPR、表示モードが一致する基準だけを比較する。HMR、受入debug、productionは別条件とする。ソースrevisionは比較の前後で異なってよいが記録を必須とする。

| 指標 | 中央値の判定上限 |
|---|---|
| `loadMs` | 基準の1.5倍 + 250ms |
| `editMs` / `syncMs` | 基準の1.5倍 + 100ms |
| `scrollSweepMs` | 基準の1.5倍 + 100ms |
| `maxFrameMs` | 基準の1.75倍 + 8ms |

閾値を測定結果に合わせて緩めない。悪化時はプロファイルを取得し、画像読込、構文解析、編集、レイアウト、同期処理を分けて確認する。有効なDesktop初期基準がまだない環境では「比較未確認」と記録し、WebブラウザーやNode単体測定でDesktop WebView2の合格を代用しない。

## 大きな埋め込み画像の解析

共有UIでは長いBase64画像データを解析専用の短いtokenへ置き換え、構文解析後に元のURL・値・行列・UTF-16 offsetを復元する。ユーザー本文・保存内容は変更しない。短縮処理の回帰では、通常Markdown、HTML画像、コード内の文字列、CRLF、複数画像、Unicodeを含む元ASTと一致することを検査する。同一本文の読取用ASTも件数・文字数上限つきで共有し、画像一覧・目次・編集範囲の重複解析を避ける。
