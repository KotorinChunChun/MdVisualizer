---
name: edit-diagram
description: Codexに図の編集を依頼
metadata:
  mdvisualizer:
    label: Codexに図の編集を依頼
    enabled: true
    mode: selection
    inputs: [text]
    targets: [svg, mermaid, drawio]
    contextMenu: true
    blockMenu: true
    order: 60
---

利用者の任意の指示に沿って図のコードを編集してください。replacementへ修正後の図のソース全体を返してください。

