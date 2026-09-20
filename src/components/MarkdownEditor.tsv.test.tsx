import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { MarkdownEditor } from "./MarkdownEditor";

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(cleanup);

it.each(["```tsv", "~~~tsv", "```TSV"])("%s本文のカーソル位置にタブを挿入しUndoできる", (opening) => {
  const value = `${opening}\nabcdef\n${opening.slice(0, 3)}`;
  const { container } = render(<MarkdownEditor documentId="tsv" value={value} dirty={false} saving={false} onChange={() => {}} onSave={() => {}} />);
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
  const position = opening.length + 4;
  act(() => view.dispatch({ selection: { anchor: position } }));
  fireEvent.keyDown(view.contentDOM, { key: "Tab", code: "Tab" });
  expect(view.state.doc.toString()).toBe(value.slice(0, position) + "\t" + value.slice(position));
  fireEvent.keyDown(view.contentDOM, { key: "z", ctrlKey: true });
  expect(view.state.doc.toString()).toBe(value);
});

it("通常のコードブロックは行頭インデントを維持する", () => {
  const value = "```text\nabcdef\n```";
  const { container } = render(<MarkdownEditor documentId="text" value={value} dirty={false} saving={false} onChange={() => {}} onSave={() => {}} />);
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
  act(() => view.dispatch({ selection: { anchor: 11 } }));
  fireEvent.keyDown(view.contentDOM, { key: "Tab", code: "Tab" });
  expect(view.state.doc.line(2).text).toMatch(/^\s+abcdef$/);
});
