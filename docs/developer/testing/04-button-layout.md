# ボタンの外観・配置チェック

静的解析を主軸とし、実画面の寸法測定を補助にする。CSSの値の分布から不揃いの候補を見つけ、用途・カスケード・フォントによる違いを確認して修正する。

## 毎回の実行

`npm.cmd test`の前処理では`test-button-style-rules.mjs`がsrcとweb/srcのJSXを走査し、ボタンのインラインstyle禁止と共通状態規則を検査する。続いて`test-css-style-stats.mjs`がCSS統計を出力する。この2つはブラウザーを起動しない。Webビルド後の実寸監査は補助として維持し、`postbuild:web`から`test:button-layout-web`を実行する。

```powershell
npm.cmd run test:button-style-rules
npm.cmd run test:css-style-stats
npm.cmd run build:web
# 生成済みHTMLだけを再確認
npm.cmd run test:button-layout-web
```

PlaywrightとEdgeを使用する。別の対応ブラウザーを使う環境では`MDVISUALIZER_BROWSER_CHANNEL`を設定する。URLは`npm.cmd run test:button-layout-web -- <URL>`で渡せる。ログの版は`MDVISUALIZER_VERSION`を優先し、未指定時はpackage.jsonから決定する。JSONはその版のlogs配下に保存する。

## 静的統計から修正候補を選ぶ

PostCSSでsrc、web/src、spfx/srcのCSS/SCSSを解析し、height、min-height、font-size、line-height、padding、border-radiusの値の分布を出す。生成物、依存物、提供試作は対象外。同じ用途の中で出現が少ない値を候補にし、ファイル・行・セレクターを示す。分布はCSS宣言数であり、表示中のボタン数やカスケード後の適用数ではない。

一度しか出ない値でも、タッチ用の大きな操作、ステータス欄、メディア条件付きレイアウトなどは正当な場合がある。少数値だけを理由にテストを失敗させず、用途の違いを確認して共通トークンへ寄せる。var()/相対単位/calc()は無理にpxへ変換しない。未解析構文や、寸法が親・既定フォント・別セレクターから継承されるケースはレポートの限界として扱う。

用途とcontrol/containerの種別ごとに出現数・割合を示す。母数5件以上かつ2種類以上の値がある群で、1回だけ現れる値を少数値候補とする。media条件と!importantは候補の定義位置に併記し、比較時に確認する。font短縮指定、paddingの方向別指定、CSS以外に埋め込まれたスタイルはこの分布の対象外。

今後はトークンの許可値と理由付き例外を用途別に確定し、新たな未承認値の増加を静的ゲートで止める。既存の少数値を全部許可して固定する方法や、多数派の値へ一律変換する方法は使わない。

## 補助の実寸検査と例外

390px/1280pxでヘッダー、表示設定、編集ツールバー、表示中の図ツールバー、HTML出力ダイアログのbutton/selectを測る。同じ行の高さ・縦中央の差が2pxを超えた場合と、親領域からはみ出した場合を失敗とする。縦領域が小さい方の高さの50%以上重なる操作を同一行とし、折り返し行同士は比較しない。意図的な高さ差・縦ずれを検知できることも毎回自己検証する。

`scripts/button-layout-audit.mjs`を共通利用する。必須scope不存在やボタン0件は成功にしない。意図した差はscope・check・buttonLabel・reasonを指定して例外を明記する。失敗を消すために許容差を広げず、本文の折りたたみ、図そのものを開くボタン、縦メニューは用途に合う操作グループへ分ける。

デスクトップでは状態APIで文書を保護し、CDP接続したpageに`collectButtonLayoutAudit(page, DESKTOP_BUTTON_LAYOUT_SCOPES)`と`assertButtonLayoutAudit`を適用する。開いたダイアログも別scopeで検査する。閉じている画面まで検証済みとは扱わない。

## 共通スタイルと拡張方針

主要ツールバーは`--toolbar-control-height`、`--toolbar-control-font-size`、`--toolbar-control-line-height`を使う。ステータス欄、タッチ、本文内操作は用途別の寸法を持つ。固定heightで文字を切らず、明示line-heightとmin-heightで文字種による差を抑える。

色・角丸・hover/focus/disabledは共通CSS変数と静的規則を使い、明暗テーマの画像確認で補う。現段階の実寸監査はアプリ全画面のデザイン一致を保証しない。今後は設定・画像編集・表編集・Mermaid等のfixtureを追加し、同じ監査器をデスクトップsmokeとCIへ接続する。画像差分はOS・フォント差で揺れるため、固定環境の補助検査として導入する。
