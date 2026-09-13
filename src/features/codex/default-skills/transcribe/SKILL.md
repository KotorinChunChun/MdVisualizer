---
name: transcribe
description: 画像から文字起こし
metadata:
  mdvisualizer:
    label: 画像から文字起こし
    enabled: true
    mode: question
    inputs: [image]
    targets: [image]
    contextMenu: true
    blockMenu: false
    order: 30
---

画像内の文章全文を読み順に文字起こししてください。文章は文章の形で、表らしい部分は必要に応じTSVで返してください。表の再構成より全文の抽出を重視します。判読不能は[判読不能]と記載し、推測で補わないでください。replacementはnullにしてください。

