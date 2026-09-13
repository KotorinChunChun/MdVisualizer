---
name: edit
description: Codexに修正を依頼
metadata:
  mdvisualizer:
    label: Codexに修正を依頼
    enabled: true
    mode: selection
    inputs: [text]
    targets: [text, code]
    contextMenu: true
    blockMenu: true
    order: 10
---

利用者の指示に沿って対象を修正してください。編集許可の範囲を守り、replacementへ置換後の対象全文を返してください。

