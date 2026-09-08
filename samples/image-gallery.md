# 画像大量表示テスト

[検証用サンプル目次へ戻る](sample.md)

多数のローカル画像を含むMarkdownを開いたときの、表示速度、スクロール、画像一覧、
ポップアップ、ファイル監視、印刷レイアウトを確認するためのサンプルです。

## PNG連続表示

同じラスター画像を異なるaltテキストで連続表示します。

![PNG 01](data:image/png;base64,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)

![PNG 02](images/sample.png)

![PNG 03](images/sample.png)

![PNG 04](images/sample.png)

![PNG 05](images/sample.png)

![PNG 06](images/sample.png)

![PNG 07](images/sample.png)

![PNG 08](images/sample.png)

![PNG 09](images/sample.png)

![PNG 10](images/sample.png)

![PNG 11](images/sample.png)

![PNG 12](images/sample.png)

## SVG連続表示

SVGは表示とポップアップの対象ですが、ラスター画像用のクロップ操作は行いません。

![SVG 01](images/sample.svg)

![SVG 02](images/sample.svg)

![SVG 03](images/sample.svg)

![SVG 04](images/sample.svg)

![SVG 05](images/sample.svg)

![SVG 06](images/sample.svg)

![SVG 07](images/sample.svg)

![SVG 08](images/sample.svg)

## リスト内の画像

- リスト画像 01  
  ![リスト内 PNG 01](images/sample.png)
- リスト画像 02  
  ![リスト内 SVG 02](images/sample.svg)
- リスト画像 03  
  ![リスト内 PNG 03](images/sample.png)
- リスト画像 04  
  ![リスト内 SVG 04](images/sample.svg)

## 引用内の画像

> 引用画像 01
>
> ![引用内 PNG 01](images/sample.png)
>
> 引用画像 02
>
> ![引用内 SVG 02](images/sample.svg)

## 表内の画像

| 番号 | PNG | SVG |
| :---: | :---: | :---: |
| 01 | ![表内 PNG 01](images/sample.png) | ![表内 SVG 01](images/sample.svg) |
| 02 | ![表内 PNG 02](images/sample.png) | ![表内 SVG 02](images/sample.svg) |
| 03 | ![表内 PNG 03](images/sample.png) | ![表内 SVG 03](images/sample.svg) |
| 04 | ![表内 PNG 04](images/sample.png) | ![表内 SVG 04](images/sample.svg) |

## Obsidian画像記法

`![[画像パス|代替テキスト]]` 記法の画像も複数表示します。

![[images/sample.png|Obsidian PNG 01]]

![[images/sample.svg|Obsidian SVG 02]]

![[images/sample.png|240]]

![[images/sample.png|Obsidian PNG 04]]

## 空白行なしの連続画像

次の各行は画像の間に空白行を置いていません。2枚、3枚、4枚がそれぞれ等幅（1/2、1/3、1/4）で横並びになることを確認します。

![横並び 2-1](images/sample.png)
![横並び 2-2](images/sample.png)

![横並び 3-1](images/sample.png)
![横並び 3-2](images/sample.png)
![横並び 3-3](images/sample.png)

![横並び 4-1](images/sample.png)
![横並び 4-2](images/sample.svg)
![横並び 4-3](images/sample.png)
![横並び 4-4](images/sample.svg)

---

表示しながら `images/sample.png` または `images/sample.svg` を更新し、
同じ画像を参照しているすべての箇所が再描画されることも確認できます。
