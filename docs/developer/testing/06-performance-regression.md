# 性能回帰測定

## 目的

ビジュアル表示に機能を追加したとき、画像・図・スクロール同期の処理が急に遅くなっていないかを、同じ負荷試験で比較できるようにする。

## 固定入力

対象は`/samples/v0.0.18.4-100-embedded-images.md`である。生成元は`/scripts/generate-embedded-image-load-fixture.mjs`で、100枚の500×500 PNGをdata URLとして生成する。サンプルを直接編集せず、生成スクリプトを変更してから再生成する。

## 計測値

デバッグ版WebView2に対して、次の値を計測する。

- `loadMs`: 100枚すべてがロード完了するまでの時間
- `scrollSweepMs`: プレビューの先頭から末尾まで一定区間を移動して戻る時間
- `maxFrameMs`: 計測中のフレーム間隔の最大値
- `brokenImages`: 壊れた画像の数
- `scrollHeight`: 表示内容の高さ

結果は対象版の`dev/history/vX.Y.Z/logs/`へ保存し、基準値はGit管理する`tests/performance/baselines/embedded-images-load.json`に保存する。ログと基準値を混同しない。

## 実行方法

デバッグ版をリモートデバッグポート9333で起動した状態で、通常の回帰測定を実行する。

```powershell
node scripts/test-embedded-image-load.mjs 9333 dev/history/v0.0.18.4/logs/embedded-images-load
```

初回または、測定環境・入力・意図した性能変更を確認した後だけ基準値を更新する。

```powershell
node scripts/test-embedded-image-load.mjs 9333 dev/history/v0.0.18.4/logs/embedded-images-load --update-baseline
```

`package.json`には同じ操作のショートカットとして`test:embedded-images`と`test:embedded-images:update-baseline`を用意する。基準値がない状態や、許容範囲を超えた悪化はコマンドを失敗させる。

## 回帰判定

現在の基準値に対して、次のいずれかを超えた場合を回帰とする。

| 指標 | 判定上限 |
|---|---|
| `loadMs` | 基準値の1.5倍 + 250ms |
| `scrollSweepMs` | 基準値の1.5倍 + 100ms |
| `maxFrameMs` | 基準値の1.75倍 + 8ms |

閾値は小さな環境差で失敗しないための初期値であり、測定結果を見ずに緩和しない。複数回連続して悪化する場合は、閾値を変更する前にプロファイルを採取する。

## 運用ルール

1. 機能追加前に既存基準で測定し、基準値と結果を保存する。
2. 機能追加後に同じ入力・同じビルド種別で測定する。
3. 回帰が出た場合は、画像ロード、スクロール、フレーム時間のどれが悪化したかを分けて確認する。
4. 意図した性能コストである場合も、理由と新しい測定値を実装報告へ記録する。
5. 基準値の更新は、実装後の比較結果を確認してから行う。

この測定はWebView2の実画面性能を対象とする。Vitestや静的検査の成功だけでは、スクロール性能の合格とはしない。
