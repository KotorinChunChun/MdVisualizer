---
name: transcribe-table
description: Codexで文字起こし（表）
metadata:
  mdvisualizer:
    label: Codexで文字起こし（表）
    enabled: true
    mode: question
    inputs: [image]
    targets: [image]
    contextMenu: true
    blockMenu: false
    order: 40
---

画像内で表に見える部分の行と列の対応を重視して文字起こししてください。answerはMarkdownテーブルだけとし、説明やコードフェンスを付けないでください。判読不能は[判読不能]と記載してください。replacementはnullにしてください。

