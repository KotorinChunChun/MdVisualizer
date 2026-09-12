# MdVisualizer アイコン素材

2026-09-12作成。候補01を採用。製品設定への組み込みは未実施。

## 原本と出力

- `svg/`: 加工用のベクタ原本。文字もパスで保持し、フォントに依存しない。
- `png/`: app・md・svg・drawio・mmd・tsvごとの透過PNG。
- `ico/`: 各種類の複数解像度ICO。16・20・24・32・40・48・64・96・128・256pxを格納。
- `msix/`: StoreLogo、Square44x44Logo、Square150x150Logo、Square71x71Logo、Square310x310Logo。基準サイズとscale-100/125/150/200/400、Square44のtargetsize画像を収録。
- `store/app-icon-1024.png`: Store掲載向けの高解像度素材。申請時の掲載枠・要件への適合確認は公開時に行う。
- `preview.png`: 全種類と16・24・32・48pxの一覧。
- `manifest.json`: 通常PNG寸法とICO収録サイズ。

通常PNGは16・20・24・30・32・40・44・48・50・60・64・71・80・89・96・107・128・142・150・176・192・200・256・284・300・310・512・600・620・1024px。

| 原本名 | 表記 | 用途 |
|---|---|---|
| app | MdV | アプリ・EXE・Store |
| md | Md | .md / .markdown |
| svg | SVG | .svg |
| drawio | DRAW | .drawio |
| mmd | MMD | .mmd / .mermaid |
| tsv | TSV | .tsv |

## 再生成と検証

Node.jsとsharpを用い、`node generate.cjs`で再生成する。sharpが標準探索パス外の場合は環境変数`ICON_SHARP_MODULE`にモジュールの絶対パスを指定する。

現行スクリプトは採用候補01と文字パス定義からSVG原本も再生成するため、手動加工済みSVGがある場合は再実行前に保存し、変更内容を生成処理へ反映すること。

通常PNGの寸法・アルファチャンネル、ICOディレクトリと各格納PNGの寸法を自動照合済み。一覧PNGを目視確認済み。16pxでは特に4文字のDRAWは判読性に限界があり、実際のExplorer表示による受入は別PCで行う。EXEへの埋め込み・Windows関連付け・Store申請は未実施。
