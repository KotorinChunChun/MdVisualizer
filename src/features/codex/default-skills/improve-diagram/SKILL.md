---
name: improve-diagram
description: AIで見た目を改善
metadata:
  mdvisualizer:
    label: AIで見た目を改善
    enabled: true
    mode: selection
    inputs: [text, image]
    targets: [svg, mermaid, drawio]
    contextMenu: true
    blockMenu: true
    order: 50
---

添付の可視化後の画像と元コードを参照し、意味、接続、ラベルを保って配置、余白、文字サイズ、配色を改善してください。利用者の追加指示を優先してください。replacementに修正後ソース全体を返してください。
