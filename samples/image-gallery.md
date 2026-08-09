# 画像大量表示テスト

[検証用サンプル目次へ戻る](sample.md)

多数のローカル画像を含むMarkdownを開いたときの、表示速度、スクロール、画像一覧、
ポップアップ、ファイル監視、印刷レイアウトを確認するためのサンプルです。

## PNG連続表示

同じラスター画像を異なるaltテキストで連続表示します。

![PNG 01](images/sample.png)

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
