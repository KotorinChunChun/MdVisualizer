// @ts-nocheck -- CSS契約は正本を読み取って検証する。
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const read = name => readFileSync(`web-platform/packages/editor-ui/src/${name}`, "utf8");
it("現在位置と範囲選択は共通トークンへ集約し目次・検索と分離する", () => {
  const css = read("styles/selection-state.css");
  expect(css).toContain("10%, var(--selection-surface)");
  expect(css).toContain("28%, var(--selection-surface)");
  expect(css).toContain("@media print");
  expect(read("components/MarkdownEditor.tsx")).toContain('backgroundColor: "var(--selection-range-bg)"');
  expect(read("styles/delimited-table.css")).toContain("background: var(--selection-range-bg)");
  expect(read("styles/preview-block-reorder.css")).not.toContain("opacity:.78");
  expect(read("styles/document-toc.css")).toContain("20%");
  expect(read("styles/app.css")).toContain("background: #fbbf24");
});
