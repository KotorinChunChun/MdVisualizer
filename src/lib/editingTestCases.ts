import { history, moveLineDown, moveLineUp, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, findClusterBreak, type StateCommand, type Transaction } from "@codemirror/state";
import {
  buildContextualMarkdownEdit,
  buildOrderedListNormalization,
  buildStructuredListEnter,
  buildStructuredListIndent,
  buildStructuredListMove,
  buildStructuredListPaste,
  buildStructuredListSoftEnter,
  buildStructuredListToggle,
  detectLineEnding,
  moveHeadingBlock,
  normalizeLineEndings,
  parseMarkdownHeadingBlocks,
  type MarkdownEditAction,
  type MarkdownEditChange,
  type StructuredListKind,
} from "./markdownEditing";

export const EDITING_CARET_MARKER = "¦";
export const EDITING_SELECTION_START = "⟦";
export const EDITING_SELECTION_END = "⟧";
export const EDITING_DESTINATION_MARKER = "◆";

export type EditingTestCategory =
  | "文字入力"
  | "選択置換"
  | "削除"
  | "改行"
  | "リスト切替"
  | "リスト階層"
  | "リスト移動"
  | "貼り付け"
  | "ツールバー"
  | "自動正規化"
  | "行入替"
  | "切り取り・貼り付け"
  | "見出し入替"
  | "Markdown構文"
  | "Unicode"
  | "境界値"
  | "履歴"
  | "特殊文字";

type EditingOperation =
  | { type: "insert"; text: string }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "enter" }
  | { type: "soft-enter" }
  | { type: "toggle-list"; kind: StructuredListKind }
  | { type: "indent"; outdent?: boolean }
  | { type: "move-list"; direction: -1 | 1 }
  | { type: "paste"; text: string }
  | { type: "toolbar"; action: MarkdownEditAction }
  | { type: "normalize" }
  | { type: "move-lines"; direction: -1 | 1 }
  | { type: "cut-paste" }
  | { type: "move-heading"; position: "before" | "after" }
  | { type: "history"; insert: string; undoCount: number; redoCount: number };

export interface EditingTestCase {
  id: string;
  category: EditingTestCategory;
  description: string;
  before: string;
  key: string;
  expectedAfter: string;
  operation: EditingOperation;
}

export interface EditingTestResult extends EditingTestCase {
  actualAfter: string;
  passed: boolean;
  error?: string;
}

interface ParsedAnnotatedText {
  text: string;
  from: number;
  to: number;
  destination: number | null;
}

function parseAnnotatedText(value: string): ParsedAnnotatedText {
  let text = "";
  let caret: number | null = null;
  let selectionStart: number | null = null;
  let selectionEnd: number | null = null;
  let destination: number | null = null;
  for (const character of value) {
    if (character === EDITING_CARET_MARKER) {
      if (caret !== null) throw new Error("カーソル目印は1個だけ指定してください。");
      caret = text.length;
    } else if (character === EDITING_SELECTION_START) {
      if (selectionStart !== null) throw new Error("選択開始目印は1個だけ指定してください。");
      selectionStart = text.length;
    } else if (character === EDITING_SELECTION_END) {
      if (selectionEnd !== null) throw new Error("選択終了目印は1個だけ指定してください。");
      selectionEnd = text.length;
    } else if (character === EDITING_DESTINATION_MARKER) {
      if (destination !== null) throw new Error("移動先目印は1個だけ指定してください。");
      destination = text.length;
    } else {
      text += character;
    }
  }
  if (caret !== null && selectionStart === null && selectionEnd === null) return { text, from: caret, to: caret, destination };
  if (caret === null && selectionStart !== null && selectionEnd !== null && selectionEnd >= selectionStart) {
    return { text, from: selectionStart, to: selectionEnd, destination };
  }
  throw new Error("入力前テキストには¦または⟦選択範囲⟧を指定してください。");
}

function applyChange(source: string, change: MarkdownEditChange | null): string {
  if (!change) return source;
  return source.slice(0, change.from) + change.insert + source.slice(change.to);
}

function previousCharacterStart(source: string, position: number): number {
  if (position >= 2 && source.slice(position - 2, position) === "\r\n") return position - 2;
  return position <= 0 ? 0 : findClusterBreak(source, position, false);
}

function nextCharacterEnd(source: string, position: number): number {
  if (source.slice(position, position + 2) === "\r\n") return position + 2;
  return position >= source.length ? source.length : findClusterBreak(source, position, true);
}

function executeStateCommand(source: string, from: number, to: number, command: StateCommand): string {
  const internalPosition = (position: number) => source.slice(0, position).replace(/\r\n|\r/g, "\n").length;
  let state = EditorState.create({
    doc: source,
    selection: EditorSelection.single(internalPosition(from), internalPosition(to)),
    extensions: [EditorState.lineSeparator.of(documentLineEnding(source))],
  });
  const handled = command({
    state,
    dispatch: (transaction: Transaction) => { state = transaction.state; },
  });
  return handled ? state.sliceDoc() : source;
}

function cutAndPaste(source: string, from: number, to: number, destination: number | null): string {
  if (from === to || destination === null) return source;
  const cut = source.slice(from, to);
  const without = source.slice(0, from) + source.slice(to);
  const mappedDestination = destination <= from ? destination : destination >= to ? destination - (to - from) : from;
  return without.slice(0, mappedDestination) + cut + without.slice(mappedDestination);
}

function moveAnnotatedHeading(source: string, sourcePosition: number, destination: number | null, position: "before" | "after"): string {
  if (destination === null) return source;
  const headings = parseMarkdownHeadingBlocks(source);
  const sourceHeading = headings.find((heading) => sourcePosition >= heading.start && sourcePosition <= heading.lineEnd);
  const targetHeading = headings.find((heading) => destination >= heading.start && destination <= heading.lineEnd);
  if (!sourceHeading || !targetHeading) return source;
  return moveHeadingBlock(source, sourceHeading.start, targetHeading.start, position) ?? source;
}

function executeHistory(source: string, from: number, to: number, insert: string, undoCount: number, redoCount: number): string {
  const internalPosition = (position: number) => source.slice(0, position).replace(/\r\n|\r/g, "\n").length;
  let state = EditorState.create({
    doc: source,
    selection: EditorSelection.single(internalPosition(from), internalPosition(to)),
    extensions: [EditorState.lineSeparator.of(documentLineEnding(source)), history()],
  });
  state = state.update({
    changes: { from: state.selection.main.from, to: state.selection.main.to, insert },
    selection: { anchor: state.selection.main.from + insert.length },
    userEvent: "input.type",
  }).state;
  const commandTarget = () => ({
    state,
    dispatch: (transaction: Transaction) => { state = transaction.state; },
  });
  for (let index = 0; index < undoCount; index += 1) undo(commandTarget());
  for (let index = 0; index < redoCount; index += 1) redo(commandTarget());
  return state.sliceDoc();
}

function replaceRange(source: string, from: number, to: number, insert: string): string {
  return source.slice(0, from) + insert + source.slice(to);
}

function documentLineEnding(source: string): string {
  return detectLineEnding(source);
}

function toolbarChange(source: string, from: number, to: number, action: MarkdownEditAction): MarkdownEditChange | null {
  const listKind: Partial<Record<MarkdownEditAction, StructuredListKind>> = {
    "unordered-list": "unordered",
    "ordered-list": "ordered",
    "task-list": "task-unchecked",
  };
  const kind = listKind[action];
  return kind
    ? buildStructuredListToggle(source, from, to, kind)
    : buildContextualMarkdownEdit(source, from, to, action, to);
}

export function executeEditingTestCase(testCase: EditingTestCase): EditingTestResult {
  try {
    const { text: source, from, to, destination } = parseAnnotatedText(testCase.before);
    let actualAfter = source;
    switch (testCase.operation.type) {
      case "insert":
        actualAfter = replaceRange(source, from, to, testCase.operation.text);
        break;
      case "backspace":
        actualAfter = from !== to
          ? replaceRange(source, from, to, "")
          : replaceRange(source, previousCharacterStart(source, from), from, "");
        break;
      case "delete":
        actualAfter = from !== to
          ? replaceRange(source, from, to, "")
          : replaceRange(source, from, nextCharacterEnd(source, from), "");
        break;
      case "enter": {
        const structured = buildStructuredListEnter(source, from, to);
        actualAfter = structured
          ? applyChange(source, structured)
          : replaceRange(source, from, to, documentLineEnding(source));
        break;
      }
      case "soft-enter": {
        const structured = buildStructuredListSoftEnter(source, from, to);
        actualAfter = structured
          ? applyChange(source, structured)
          : replaceRange(source, from, to, documentLineEnding(source));
        break;
      }
      case "toggle-list":
        actualAfter = applyChange(source, buildStructuredListToggle(source, from, to, testCase.operation.kind));
        break;
      case "indent":
        actualAfter = applyChange(source, buildStructuredListIndent(source, from, to, testCase.operation.outdent));
        break;
      case "move-list":
        actualAfter = applyChange(source, buildStructuredListMove(source, to, testCase.operation.direction));
        break;
      case "paste": {
        const pasted = normalizeLineEndings(testCase.operation.text, detectLineEnding(source));
        const structured = buildStructuredListPaste(source, from, to, pasted);
        actualAfter = structured
          ? applyChange(source, structured)
          : replaceRange(source, from, to, pasted);
        break;
      }
      case "toolbar":
        actualAfter = applyChange(source, toolbarChange(source, from, to, testCase.operation.action));
        break;
      case "normalize":
        actualAfter = applyChange(source, buildOrderedListNormalization(source, from, to));
        break;
      case "move-lines": {
        const structured = buildStructuredListMove(source, to, testCase.operation.direction);
        actualAfter = structured
          ? applyChange(source, structured)
          : executeStateCommand(source, from, to, testCase.operation.direction < 0 ? moveLineUp : moveLineDown);
        break;
      }
      case "cut-paste":
        actualAfter = cutAndPaste(source, from, to, destination);
        break;
      case "move-heading":
        actualAfter = moveAnnotatedHeading(source, to, destination, testCase.operation.position);
        break;
      case "history":
        actualAfter = executeHistory(source, from, to, testCase.operation.insert, testCase.operation.undoCount, testCase.operation.redoCount);
        break;
    }
    return { ...testCase, actualAfter, passed: actualAfter === testCase.expectedAfter };
  } catch (error) {
    return {
      ...testCase,
      actualAfter: "",
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function runEditingTestCases(cases: readonly EditingTestCase[] = EDITING_TEST_CASES): EditingTestResult[] {
  return cases.map(executeEditingTestCase);
}

const testCase = (
  id: string,
  category: EditingTestCategory,
  description: string,
  before: string,
  key: string,
  expectedAfter: string,
  operation: EditingOperation,
): EditingTestCase => ({ id, category, description, before, key, expectedAfter, operation });

const BASE_EDITING_TEST_CASES: readonly EditingTestCase[] = [
  testCase("input-empty-ascii", "文字入力", "空文書へ英字", "¦", "a", "a", { type: "insert", text: "a" }),
  testCase("input-start", "文字入力", "行頭へ入力", "¦beta", "alpha ", "alpha beta", { type: "insert", text: "alpha " }),
  testCase("input-middle", "文字入力", "単語の途中へ入力", "mark¦down", "-", "mark-down", { type: "insert", text: "-" }),
  testCase("input-end", "文字入力", "行末へ入力", "text¦", "!", "text!", { type: "insert", text: "!" }),
  testCase("input-japanese", "文字入力", "日本語を入力", "題名: ¦", "日本語", "題名: 日本語", { type: "insert", text: "日本語" }),
  testCase("input-emoji", "文字入力", "絵文字を入力", "状態 ¦", "✅", "状態 ✅", { type: "insert", text: "✅" }),
  testCase("input-combining", "文字入力", "結合文字を入力", "Cafe¦", "\u0301", "Cafe\u0301", { type: "insert", text: "\u0301" }),
  testCase("input-markdown-marker", "文字入力", "Markdown記号を入力", "見出し¦", "# ", "見出し# ", { type: "insert", text: "# " }),
  testCase("input-inline-code", "文字入力", "インラインコード断片を入力", "値は¦です", "`x`", "値は`x`です", { type: "insert", text: "`x`" }),
  testCase("input-second-line", "文字入力", "2行目へ入力", "one\nt¦wo", "X", "one\ntXwo", { type: "insert", text: "X" }),

  testCase("replace-character", "選択置換", "1文字を置換", "a⟦b⟧c", "B", "aBc", { type: "insert", text: "B" }),
  testCase("replace-word", "選択置換", "単語を置換", "before ⟦old⟧ after", "new", "before new after", { type: "insert", text: "new" }),
  testCase("replace-line", "選択置換", "行全体を置換", "one\n⟦two⟧\nthree", "second", "one\nsecond\nthree", { type: "insert", text: "second" }),
  testCase("replace-multiline", "選択置換", "複数行を置換", "a\n⟦b\nc⟧\nd", "x", "a\nx\nd", { type: "insert", text: "x" }),
  testCase("replace-with-newline", "選択置換", "選択を複数行へ置換", "⟦one line⟧", "one↵two", "one\ntwo", { type: "insert", text: "one\ntwo" }),
  testCase("replace-all", "選択置換", "文書全体を置換", "⟦old document⟧", "new document", "new document", { type: "insert", text: "new document" }),
  testCase("replace-japanese", "選択置換", "日本語選択を置換", "これは⟦旧文⟧です", "新文", "これは新文です", { type: "insert", text: "新文" }),
  testCase("replace-emoji", "選択置換", "絵文字を置換", "状態: ⟦❌⟧", "✅", "状態: ✅", { type: "insert", text: "✅" }),

  testCase("backspace-middle", "削除", "直前の英字を削除", "ab¦cd", "Backspace", "acd", { type: "backspace" }),
  testCase("backspace-start", "削除", "文書先頭のBackspace", "¦abc", "Backspace", "abc", { type: "backspace" }),
  testCase("backspace-end", "削除", "文書末尾のBackspace", "abc¦", "Backspace", "ab", { type: "backspace" }),
  testCase("backspace-emoji", "削除", "絵文字1文字を削除", "A✅¦B", "Backspace", "AB", { type: "backspace" }),
  testCase("backspace-lf", "削除", "LF改行を連結", "one\n¦two", "Backspace", "onetwo", { type: "backspace" }),
  testCase("backspace-crlf", "削除", "CRLF改行を一度で連結", "one\r\n¦two", "Backspace", "onetwo", { type: "backspace" }),
  testCase("backspace-selection", "削除", "選択範囲をBackspaceで削除", "a⟦bc⟧d", "Backspace", "ad", { type: "backspace" }),
  testCase("backspace-multiline-selection", "削除", "複数行選択をBackspaceで削除", "a⟦\nb\n⟧c", "Backspace", "ac", { type: "backspace" }),
  testCase("delete-middle", "削除", "直後の英字を削除", "ab¦cd", "Delete", "abd", { type: "delete" }),
  testCase("delete-start", "削除", "文書先頭のDelete", "¦abc", "Delete", "bc", { type: "delete" }),
  testCase("delete-end", "削除", "文書末尾のDelete", "abc¦", "Delete", "abc", { type: "delete" }),
  testCase("delete-emoji", "削除", "直後の絵文字を削除", "A¦✅B", "Delete", "AB", { type: "delete" }),
  testCase("delete-lf", "削除", "次のLF改行を連結", "one¦\ntwo", "Delete", "onetwo", { type: "delete" }),
  testCase("delete-crlf", "削除", "次のCRLF改行を一度で連結", "one¦\r\ntwo", "Delete", "onetwo", { type: "delete" }),
  testCase("delete-selection", "削除", "選択範囲をDeleteで削除", "a⟦bc⟧d", "Delete", "ad", { type: "delete" }),

  testCase("enter-empty", "改行", "空文書で改行", "¦", "Enter", "\n", { type: "enter" }),
  testCase("enter-middle", "改行", "行の途中で分割", "one¦two", "Enter", "one\ntwo", { type: "enter" }),
  testCase("enter-selection", "改行", "選択を改行へ置換", "a⟦bc⟧d", "Enter", "a\nd", { type: "enter" }),
  testCase("enter-crlf", "改行", "CRLF文書で改行", "one\r\ntw¦o", "Enter", "one\r\ntw\r\no", { type: "enter" }),
  testCase("enter-unordered", "改行", "箇条書きを継続", "- item¦", "Enter", "- item\n- ", { type: "enter" }),
  testCase("enter-unordered-split", "改行", "箇条書き本文を分割", "- it¦em", "Enter", "- it\n- em", { type: "enter" }),
  testCase("enter-ordered", "改行", "番号付きリストを継続", "1. item¦", "Enter", "1. item\n2. ", { type: "enter" }),
  testCase("enter-ordered-renumber", "改行", "途中挿入後に番号を振り直す", "1. one¦\n2. two", "Enter", "1. one\n2. \n3. two", { type: "enter" }),
  testCase("enter-ordered-parenthesis", "改行", "丸括弧番号を継続", "1) item¦", "Enter", "1) item\n2) ", { type: "enter" }),
  testCase("enter-task-unchecked", "改行", "未完了タスクを継続", "- [ ] item¦", "Enter", "- [ ] item\n- [ ] ", { type: "enter" }),
  testCase("enter-task-checked", "改行", "完了タスクの次を未完了で作成", "- [x] done¦", "Enter", "- [x] done\n- [ ] ", { type: "enter" }),
  testCase("enter-empty-unordered", "改行", "空の箇条書きを終了", "- ¦", "Enter", "", { type: "enter" }),
  testCase("enter-empty-ordered", "改行", "空の番号付きリストを終了", "1. ¦", "Enter", "", { type: "enter" }),
  testCase("enter-empty-task", "改行", "空のタスクリストを終了", "- [ ] ¦", "Enter", "", { type: "enter" }),
  testCase("enter-nested", "改行", "入れ子リストを同じ深さで継続", "- parent\n  - child¦", "Enter", "- parent\n  - child\n  - ", { type: "enter" }),
  testCase("soft-enter-list", "改行", "リスト本文内でソフト改行", "- item¦", "Shift+Enter", "- item\n  ", { type: "soft-enter" }),
  testCase("soft-enter-task", "改行", "タスク本文内でソフト改行", "- [ ] task¦", "Shift+Enter", "- [ ] task\n  ", { type: "soft-enter" }),
  testCase("soft-enter-nested", "改行", "入れ子でソフト改行", "  - child¦", "Shift+Enter", "  - child\n    ", { type: "soft-enter" }),
  testCase("soft-enter-plain", "改行", "通常行のShift+Enter", "plain¦text", "Shift+Enter", "plain\ntext", { type: "soft-enter" }),

  testCase("toggle-unordered-plain", "リスト切替", "通常行を箇条書きへ", "it¦em", "Ctrl+.", "- item", { type: "toggle-list", kind: "unordered" }),
  testCase("toggle-unordered-off", "リスト切替", "箇条書きを解除", "- it¦em", "Ctrl+.", "item", { type: "toggle-list", kind: "unordered" }),
  testCase("toggle-ordered-plain", "リスト切替", "通常行を番号付きへ", "it¦em", "Ctrl+1", "1. item", { type: "toggle-list", kind: "ordered" }),
  testCase("toggle-ordered-off", "リスト切替", "番号付きリストを解除", "1. it¦em", "Ctrl+1", "item", { type: "toggle-list", kind: "ordered" }),
  testCase("toggle-task-unchecked", "リスト切替", "通常行を未完了タスクへ", "it¦em", "Ctrl+[", "- [ ] item", { type: "toggle-list", kind: "task-unchecked" }),
  testCase("toggle-task-checked", "リスト切替", "通常行を完了タスクへ", "it¦em", "Ctrl+]", "- [x] item", { type: "toggle-list", kind: "task-checked" }),
  testCase("toggle-task-check", "リスト切替", "未完了から完了へ", "- [ ] it¦em", "Ctrl+]", "- [x] item", { type: "toggle-list", kind: "task-checked" }),
  testCase("toggle-task-uncheck", "リスト切替", "完了から未完了へ", "- [x] it¦em", "Ctrl+[", "- [ ] item", { type: "toggle-list", kind: "task-unchecked" }),
  testCase("toggle-task-checked-off", "リスト切替", "完了タスクを解除", "- [x] it¦em", "Ctrl+]", "item", { type: "toggle-list", kind: "task-checked" }),
  testCase("toggle-multiline-unordered", "リスト切替", "複数行を箇条書きへ", "⟦alpha\nbeta⟧", "Ctrl+.", "- alpha\n- beta", { type: "toggle-list", kind: "unordered" }),
  testCase("toggle-multiline-ordered", "リスト切替", "複数行を番号付きへ", "⟦alpha\nbeta\ngamma⟧", "Ctrl+1", "1. alpha\n2. beta\n3. gamma", { type: "toggle-list", kind: "ordered" }),
  testCase("toggle-multiline-task", "リスト切替", "複数行をタスクへ", "⟦alpha\nbeta⟧", "Ctrl+[", "- [ ] alpha\n- [ ] beta", { type: "toggle-list", kind: "task-unchecked" }),
  testCase("toggle-preserve-indent", "リスト切替", "インデントを保って切替", "  alpha¦", "Ctrl+.", "  - alpha", { type: "toggle-list", kind: "unordered" }),
  testCase("toggle-skip-blank", "リスト切替", "空行を飛ばして複数行切替", "⟦alpha\n\nbeta⟧", "Ctrl+.", "- alpha\n\n- beta", { type: "toggle-list", kind: "unordered" }),
  testCase("toggle-fence-noop", "リスト切替", "コードフェンス内では切替しない", "```text\nit¦em\n```", "Ctrl+.", "```text\nitem\n```", { type: "toggle-list", kind: "unordered" }),
  testCase("toggle-convert-ordered", "リスト切替", "箇条書きを番号付きへ変換", "- a¦lpha\n- beta", "Ctrl+1", "1. alpha\n- beta", { type: "toggle-list", kind: "ordered" }),

  testCase("indent-list", "リスト階層", "リスト項目をインデント", "- one\n- t¦wo", "Tab", "- one\n  - two", { type: "indent" }),
  testCase("indent-ordered", "リスト階層", "番号付き項目を子へ", "1. one\n2. t¦wo\n3. three", "Tab", "1. one\n  1. two\n2. three", { type: "indent" }),
  testCase("indent-task", "リスト階層", "タスク項目を子へ", "- [ ] one\n- [ ] t¦wo", "Tab", "- [ ] one\n  - [ ] two", { type: "indent" }),
  testCase("indent-multiline", "リスト階層", "複数項目をインデント", "- one\n⟦- two\n- three⟧", "Tab", "- one\n  - two\n  - three", { type: "indent" }),
  testCase("indent-plain", "リスト階層", "通常行を2空白インデント", "pl¦ain", "Tab", "  plain", { type: "indent" }),
  testCase("outdent-list", "リスト階層", "子項目をアウトデント", "- one\n  - t¦wo", "Shift+Tab", "- one\n- two", { type: "indent", outdent: true }),
  testCase("outdent-four-spaces", "リスト階層", "4空白から2空白を除去", "    - ch¦ild", "Shift+Tab", "  - child", { type: "indent", outdent: true }),
  testCase("outdent-tab", "リスト階層", "タブインデントを除去", "\t- ch¦ild", "Shift+Tab", "- child", { type: "indent", outdent: true }),
  testCase("outdent-root-noop", "リスト階層", "ルート項目はアウトデント不可", "- it¦em", "Shift+Tab", "- item", { type: "indent", outdent: true }),
  testCase("outdent-multiline", "リスト階層", "複数行をアウトデント", "⟦  - one\n  - two⟧", "Shift+Tab", "- one\n- two", { type: "indent", outdent: true }),

  testCase("move-unordered-up", "リスト移動", "箇条書きを上へ", "- first\n- sec¦ond\n- third", "Alt+↑", "- second\n- first\n- third", { type: "move-list", direction: -1 }),
  testCase("move-unordered-down", "リスト移動", "箇条書きを下へ", "- fi¦rst\n- second\n- third", "Alt+↓", "- second\n- first\n- third", { type: "move-list", direction: 1 }),
  testCase("move-ordered-up", "リスト移動", "番号付き項目を上へ移動して再採番", "1. first\n2. sec¦ond\n3. third", "Alt+↑", "1. second\n2. first\n3. third", { type: "move-list", direction: -1 }),
  testCase("move-ordered-down", "リスト移動", "番号付き項目を下へ移動して再採番", "1. fi¦rst\n2. second\n3. third", "Alt+↓", "1. second\n2. first\n3. third", { type: "move-list", direction: 1 }),
  testCase("move-with-child", "リスト移動", "子項目を伴って移動", "1. fi¦rst\n   1. child\n2. second", "Alt+↓", "1. second\n2. first\n   1. child", { type: "move-list", direction: 1 }),
  testCase("move-last-with-child-up", "リスト移動", "末尾の子項目つき項目を上へ移動", "1. first\n2. sec¦ond\n   1. child", "Alt+↑", "1. second\n   1. child\n2. first", { type: "move-list", direction: -1 }),
  testCase("move-list-across-blank-lines", "リスト移動", "空行をまたぐ箇条書き項目を上へ移動", "- 1行目\n\n\n- 2¦行目", "Alt+↑", "- 2行目\n- 1行目", { type: "move-list", direction: -1 }),
  testCase("move-crlf-final-block", "リスト移動", "CRLF文書の末尾項目と子を移動", "1. fi¦rst\r\n   1. child\r\n2. second", "Alt+↓", "1. second\r\n2. first\r\n   1. child", { type: "move-list", direction: 1 }),
  testCase("move-first-up-noop", "リスト移動", "先頭項目は上へ移動不可", "- fi¦rst\n- second", "Alt+↑", "- first\n- second", { type: "move-list", direction: -1 }),
  testCase("move-last-down-noop", "リスト移動", "末尾項目は下へ移動不可", "- first\n- sec¦ond", "Alt+↓", "- first\n- second", { type: "move-list", direction: 1 }),
  testCase("move-child-across-parent-noop", "リスト移動", "子項目を親の外へ移動しない", "- parent\n  - ch¦ild\n- next", "Alt+↓", "- parent\n  - child\n- next", { type: "move-list", direction: 1 }),

  testCase("paste-plain", "貼り付け", "通常テキストを貼り付け", "before¦after", "Ctrl+V: text", "before text after", { type: "paste", text: " text " }),
  testCase("paste-replace", "貼り付け", "選択範囲へ貼り付け", "a⟦old⟧b", "Ctrl+V: new", "anewb", { type: "paste", text: "new" }),
  testCase("paste-multiline", "貼り付け", "複数行テキストを貼り付け", "start¦", "Ctrl+V: a↵b", "starta\nb", { type: "paste", text: "a\nb" }),
  testCase("paste-list-empty", "貼り付け", "空リストへリストを展開", "- ¦", "Ctrl+V: - alpha↵- beta", "- alpha\n- beta", { type: "paste", text: "- alpha\n- beta" }),
  testCase("paste-ordered-empty", "貼り付け", "空の番号付き項目へ再採番して貼り付け", "1. ¦", "Ctrl+V: 7. alpha↵9. beta", "1. alpha\n2. beta", { type: "paste", text: "7. alpha\n9. beta" }),
  testCase("paste-nested-list", "貼り付け", "空の子項目へインデントを保って貼り付け", "- parent\n  - ¦", "Ctrl+V: - alpha↵- beta", "- parent\n  - alpha\n  - beta", { type: "paste", text: "- alpha\n- beta" }),
  testCase("paste-crlf-list", "貼り付け", "CRLFリストへ改行形式を保って貼り付け", "1. ¦\r\n2. tail", "Ctrl+V: 4. a↵8. b", "1. a\r\n2. b\r\n3. tail", { type: "paste", text: "4. a\n8. b" }),
  testCase("paste-nonlist-into-empty-list", "貼り付け", "通常文の貼り付けは標準挿入", "- ¦", "Ctrl+V: alpha", "- alpha", { type: "paste", text: "alpha" }),

  testCase("toolbar-heading", "ツールバー", "行を見出しへ", "Head¦ing", "見出し", "# Heading", { type: "toolbar", action: "heading" }),
  testCase("toolbar-heading-replace", "ツールバー", "既存見出しレベルをH1へ", "### Head¦ing", "見出し", "# Heading", { type: "toolbar", action: "heading" }),
  testCase("toolbar-bold-placeholder", "ツールバー", "太字プレースホルダーを挿入", "¦", "太字", "**太字**", { type: "toolbar", action: "bold" }),
  testCase("toolbar-bold-selection", "ツールバー", "選択を太字へ", "before ⟦text⟧ after", "太字", "before **text** after", { type: "toolbar", action: "bold" }),
  testCase("toolbar-italic-placeholder", "ツールバー", "斜体プレースホルダーを挿入", "¦", "斜体", "_斜体_", { type: "toolbar", action: "italic" }),
  testCase("toolbar-italic-selection", "ツールバー", "選択を斜体へ", "⟦text⟧", "斜体", "_text_", { type: "toolbar", action: "italic" }),
  testCase("toolbar-strike-placeholder", "ツールバー", "取消線プレースホルダーを挿入", "¦", "取り消し線", "~~取り消し線~~", { type: "toolbar", action: "strike" }),
  testCase("toolbar-strike-selection", "ツールバー", "選択へ取消線", "⟦old⟧", "取り消し線", "~~old~~", { type: "toolbar", action: "strike" }),
  testCase("toolbar-inline-code-placeholder", "ツールバー", "コードプレースホルダーを挿入", "¦", "インラインコード", "`コード`", { type: "toolbar", action: "inline-code" }),
  testCase("toolbar-inline-code-selection", "ツールバー", "選択をインラインコードへ", "run ⟦npm test⟧", "インラインコード", "run `npm test`", { type: "toolbar", action: "inline-code" }),
  testCase("toolbar-quote-single", "ツールバー", "1行を引用へ", "quo¦te", "引用", "> quote", { type: "toolbar", action: "quote" }),
  testCase("toolbar-quote-multiline", "ツールバー", "複数行を引用へ", "⟦one\ntwo⟧", "引用", "> one\n> two", { type: "toolbar", action: "quote" }),
  testCase("toolbar-unordered", "ツールバー", "ツールバーで箇条書きへ", "⟦one\ntwo⟧", "箇条書き", "- one\n- two", { type: "toolbar", action: "unordered-list" }),
  testCase("toolbar-ordered", "ツールバー", "ツールバーで番号付きへ", "⟦one\ntwo⟧", "番号付きリスト", "1. one\n2. two", { type: "toolbar", action: "ordered-list" }),
  testCase("toolbar-task", "ツールバー", "ツールバーでチェックリストへ", "⟦one\ntwo⟧", "チェックリスト", "- [ ] one\n- [ ] two", { type: "toolbar", action: "task-list" }),
  testCase("toolbar-link-placeholder", "ツールバー", "リンク雛形を挿入", "¦", "リンク", "[リンク](https://)", { type: "toolbar", action: "link" }),
  testCase("toolbar-link-selection", "ツールバー", "選択文字列をリンク名へ", "see ⟦site⟧", "リンク", "see [site](https://)", { type: "toolbar", action: "link" }),
  testCase("toolbar-code-block-placeholder", "ツールバー", "コードブロック雛形を挿入", "¦", "コードブロック", "\n\n```text\nコード\n```\n\n", { type: "toolbar", action: "code-block" }),
  testCase("toolbar-code-block-selection", "ツールバー", "選択をコードブロックへ", "⟦const x = 1;⟧", "コードブロック", "\n\n```text\nconst x = 1;\n```\n\n", { type: "toolbar", action: "code-block" }),
  testCase("toolbar-table", "ツールバー", "表を挿入", "¦", "表を挿入", "\n\n| 列1 | 列2 |\n| --- | --- |\n| 値1 | 値2 |\n\n", { type: "toolbar", action: "table" }),
  testCase("toolbar-mermaid-placeholder", "ツールバー", "Mermaid雛形を挿入", "¦", "Mermaid図を挿入", "\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n", { type: "toolbar", action: "mermaid" }),
  testCase("toolbar-mermaid-selection", "ツールバー", "選択をMermaid本文へ", "⟦flowchart LR\nA-->B⟧", "Mermaid図を挿入", "\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n", { type: "toolbar", action: "mermaid" }),
  testCase("toolbar-horizontal-rule", "ツールバー", "水平線を挿入", "before¦after", "水平線", "before\n\n---\n\nafter", { type: "toolbar", action: "horizontal-rule" }),
  testCase("toolbar-drawio-placeholder", "ツールバー", "draw.io雛形を挿入", "¦", "draw.io図を挿入", "\n\n```drawio\n<mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/></root></mxGraphModel>\n```\n\n", { type: "toolbar", action: "drawio" }),
  testCase("toolbar-image-placeholder", "ツールバー", "画像雛形を挿入", "¦", "画像を挿入", "![画像](image.png)", { type: "toolbar", action: "image" }),
  testCase("toolbar-image-selection", "ツールバー", "選択を代替テキストへ", "⟦diagram⟧", "画像を挿入", "![diagram](image.png)", { type: "toolbar", action: "image" }),
  testCase("toolbar-context-fence-table", "ツールバー", "コードフェンス後へ表を挿入", "```text\nin¦side\n```\ntail", "表を挿入", "```text\ninside\n```\n\n\n| 列1 | 列2 |\n| --- | --- |\n| 値1 | 値2 |\n\ntail", { type: "toolbar", action: "table" }),
  testCase("toolbar-context-fence-mermaid", "ツールバー", "コードフェンス後へMermaidを挿入", "```text\nin¦side\n```\ntail", "Mermaid図を挿入", "```text\ninside\n```\n\n\n```mermaid\ngraph TD\n  A --> B\n```\n\ntail", { type: "toolbar", action: "mermaid" }),
  testCase("toolbar-context-fence-drawio", "ツールバー", "コードフェンス後へdraw.ioを挿入", "```text\nin¦side\n```\ntail", "draw.io図を挿入", "```text\ninside\n```\n\n\n```drawio\n<mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/></root></mxGraphModel>\n```\n\ntail", { type: "toolbar", action: "drawio" }),
  testCase("toolbar-context-tilde-fence", "ツールバー", "チルダフェンス後へ水平線を挿入", "~~~~text\nin¦side\n~~~~\ntail", "水平線", "~~~~text\ninside\n~~~~\n\n\n---\n\ntail", { type: "toolbar", action: "horizontal-rule" }),
  testCase("toolbar-context-unclosed-fence", "ツールバー", "未閉鎖フェンスを閉じてからMermaidを挿入", "```text\nin¦side", "Mermaid図を挿入", "```text\ninside\n```\n\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n", { type: "toolbar", action: "mermaid" }),
  testCase("toolbar-context-image", "ツールバー", "画像記法後へ表を挿入", "before ![al¦t](image(v2).png) after", "表を挿入", "before ![alt](image(v2).png)\n\n| 列1 | 列2 |\n| --- | --- |\n| 値1 | 値2 |\n\n after", { type: "toolbar", action: "table" }),
  testCase("toolbar-context-link", "ツールバー", "リンク記法後へMermaidを挿入", "before [li¦nk](https://example.test/a_(b)) after", "Mermaid図を挿入", "before [link](https://example.test/a_(b))\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n after", { type: "toolbar", action: "mermaid" }),
  testCase("toolbar-context-inline-code", "ツールバー", "インラインコード後へ表を挿入", "before `co¦de` after", "表を挿入", "before `code`\n\n| 列1 | 列2 |\n| --- | --- |\n| 値1 | 値2 |\n\n after", { type: "toolbar", action: "table" }),
  testCase("toolbar-context-table-disable-table", "ツールバー", "表内では表挿入を無効化", "| A | B |\n| --- | --- |\n| one | t¦wo |", "表を挿入", "| A | B |\n| --- | --- |\n| one | two |", { type: "toolbar", action: "table" }),
  testCase("toolbar-context-table-disable-mermaid", "ツールバー", "表内ではMermaid挿入を無効化", "| A | B |\n| --- | --- |\n| one | t¦wo |", "Mermaid図を挿入", "| A | B |\n| --- | --- |\n| one | two |", { type: "toolbar", action: "mermaid" }),
  testCase("toolbar-context-table-disable-drawio", "ツールバー", "表内ではdraw.io挿入を無効化", "| A | B |\n| --- | --- |\n| one | t¦wo |", "draw.io図を挿入", "| A | B |\n| --- | --- |\n| one | two |", { type: "toolbar", action: "drawio" }),

  testCase("normalize-ordered", "自動正規化", "番号付きリストを1から再採番", "4. one\n9. t¦wo\n2. three", "自動再採番", "1. one\n2. two\n3. three", { type: "normalize" }),
  testCase("normalize-nested", "自動正規化", "階層ごとに再採番", "8. one\n   7. ch¦ild\n4. two", "自動再採番", "1. one\n   1. child\n2. two", { type: "normalize" }),
  testCase("normalize-parenthesis", "自動正規化", "丸括弧番号を維持して再採番", "8) one\n3) t¦wo", "自動再採番", "1) one\n2) two", { type: "normalize" }),
  testCase("normalize-heading", "自動正規化", "番号付き見出しを兄弟順に再採番", "# 8. One\n# 3. T¦wo", "自動再採番", "# 1. One\n# 2. Two", { type: "normalize" }),
  testCase("normalize-fence-guard", "自動正規化", "コードフェンス内の番号は変更しない", "```text\n9. it¦em\n```", "自動再採番", "```text\n9. item\n```", { type: "normalize" }),
  testCase("normalize-separated", "自動正規化", "段落で分離したリストは個別に1から開始", "5. one\n\ntext\n\n8. t¦wo", "自動再採番", "1. one\n\ntext\n\n1. two", { type: "normalize" }),
  testCase("normalize-blank-list-continuation", "自動正規化", "空行だけの番号付きリストは連番を継続", "1. aaa\n\n1. b¦bb", "自動再採番", "1. aaa\n\n2. bbb", { type: "normalize" }),
  testCase("normalize-unrelated-text-resets-list", "自動正規化", "無関係な本文を挟んだ番号付きリストは再び1から開始", "1. aaa\n\n無関係なテキスト\n1. b¦bb", "自動再採番", "1. aaa\n\n無関係なテキスト\n1. bbb", { type: "normalize" }),
];

interface CursorContext {
  id: string;
  label: string;
  left: string;
  right: string;
  category?: EditingTestCategory;
}

interface InputToken {
  id: string;
  label: string;
  value: string;
}

const CURSOR_CONTEXTS: readonly CursorContext[] = [
  { id: "empty", label: "空文書", left: "", right: "", category: "境界値" },
  { id: "ascii-start", label: "英字行頭", left: "", right: "alpha" },
  { id: "ascii-middle", label: "英単語中央", left: "al", right: "pha" },
  { id: "ascii-end", label: "英字行末", left: "alpha", right: "" },
  { id: "japanese-start", label: "日本語行頭", left: "", right: "日本語", category: "Unicode" },
  { id: "japanese-middle", label: "日本語中央", left: "日本", right: "語", category: "Unicode" },
  { id: "japanese-end", label: "日本語行末", left: "日本語", right: "", category: "Unicode" },
  { id: "emoji-between", label: "絵文字の間", left: "✅", right: "❌", category: "Unicode" },
  { id: "lf-line-start", label: "LFの2行目行頭", left: "one\n", right: "two", category: "境界値" },
  { id: "lf-line-middle", label: "LFの2行目中央", left: "one\nt", right: "wo", category: "境界値" },
  { id: "lf-line-end", label: "LFの2行目行末", left: "one\ntwo", right: "\nthree", category: "境界値" },
  { id: "crlf-line-start", label: "CRLFの2行目行頭", left: "one\r\n", right: "two", category: "境界値" },
  { id: "crlf-line-middle", label: "CRLFの2行目中央", left: "one\r\nt", right: "wo", category: "境界値" },
  { id: "crlf-line-end", label: "CRLFの2行目行末", left: "one\r\ntwo", right: "\r\nthree", category: "境界値" },
  { id: "heading-h1", label: "H1本文", left: "# Head", right: "ing" },
  { id: "heading-h6", label: "H6本文", left: "###### Head", right: "ing" },
  { id: "setext", label: "Setext見出し", left: "Head", right: "ing\n======" },
  { id: "bold", label: "太字本文", left: "**bo", right: "ld**" },
  { id: "italic", label: "斜体本文", left: "_ita", right: "lic_" },
  { id: "strike", label: "取消線本文", left: "~~ol", right: "d~~" },
  { id: "inline-code", label: "インラインコード本文", left: "`co", right: "de`" },
  { id: "link-label", label: "リンクラベル", left: "[la", right: "bel](url)" },
  { id: "link-url", label: "リンクURL", left: "[label](https://exa", right: "mple.com)" },
  { id: "image-alt", label: "画像代替テキスト", left: "![al", right: "t](image.png)" },
  { id: "image-path", label: "画像パス", left: "![alt](images/", right: "image.png)" },
  { id: "blockquote", label: "引用本文", left: "> quo", right: "te" },
  { id: "unordered", label: "箇条書き本文", left: "- it", right: "em" },
  { id: "ordered", label: "番号付き本文", left: "1. it", right: "em" },
  { id: "task", label: "タスク本文", left: "- [ ] it", right: "em" },
  { id: "nested-list", label: "入れ子箇条書き本文", left: "- parent\n  - ch", right: "ild" },
  { id: "table-header", label: "表ヘッダーセル", left: "| hea", right: "der | value |" },
  { id: "table-cell", label: "表データセル", left: "| one | t", right: "wo |" },
  { id: "fence-info", label: "コードフェンス言語名", left: "```type", right: "script\ncode\n```" },
  { id: "fence-body", label: "コードフェンス本文", left: "```text\nco", right: "de\n```" },
  { id: "tilde-fence", label: "チルダフェンス本文", left: "~~~text\nco", right: "de\n~~~" },
  { id: "mermaid", label: "Mermaid本文", left: "```mermaid\ngraph TD\n  A -", right: "-> B\n```" },
  { id: "drawio", label: "draw.io XML属性", left: "```drawio\n<mxCell id=\"", right: "0\"/>\n```" },
  { id: "yaml-key", label: "YAMLキー", left: "---\ntit", right: "le: Sample\n---" },
  { id: "yaml-value", label: "YAML値", left: "---\ntitle: Sam", right: "ple\n---" },
  { id: "html-text", label: "HTML要素本文", left: "<span>te", right: "xt</span>" },
  { id: "html-attribute", label: "HTML属性値", left: "<span class=\"na", right: "me\">text</span>" },
  { id: "html-comment", label: "HTMLコメント", left: "<!-- com", right: "ment -->" },
  { id: "escaped", label: "エスケープ済み記号の後", left: "\\*literal", right: "*" },
  { id: "autolink", label: "自動リンク", left: "<https://exa", right: "mple.com>" },
  { id: "footnote", label: "脚注本文", left: "[^1]: no", right: "te" },
  { id: "reference", label: "参照リンク定義", left: "[ref]: https://exa", right: "mple.com" },
  { id: "windows-path", label: "Windowsパス", left: "C:\\docs\\sam", right: "ple.md" },
  { id: "url-query", label: "URLクエリー", left: "https://example.com?a=", right: "1&b=2" },
  { id: "parentheses", label: "丸括弧内部", left: "text (in", right: "side)" },
  { id: "fullwidth", label: "全角記号の間", left: "「前", right: "後」", category: "Unicode" },
];

const INPUT_TOKENS: readonly InputToken[] = [
  { id: "lower", label: "英小文字", value: "a" },
  { id: "upper", label: "英大文字", value: "Z" },
  { id: "digit", label: "数字", value: "7" },
  { id: "hiragana", label: "ひらがな", value: "かな" },
  { id: "kanji", label: "漢字", value: "編集" },
  { id: "fullwidth", label: "全角英数", value: "Ａ１" },
  { id: "emoji", label: "絵文字", value: "✅" },
  { id: "family", label: "ZWJ絵文字", value: "👨‍👩‍👧‍👦" },
  { id: "skin-tone", label: "肌色付き絵文字", value: "👍🏽" },
  { id: "flag", label: "国旗絵文字", value: "🇯🇵" },
  { id: "combining", label: "結合文字", value: "e\u0301" },
  { id: "space", label: "空白", value: " " },
  { id: "tab", label: "タブ", value: "\t" },
  { id: "asterisk", label: "アスタリスク", value: "*" },
  { id: "underscore", label: "アンダースコア", value: "_" },
  { id: "backtick", label: "バッククォート", value: "`" },
  { id: "brackets", label: "角括弧", value: "[x]" },
  { id: "url", label: "URL", value: "https://example.com" },
  { id: "html", label: "HTML断片", value: "<br>" },
  { id: "backslash", label: "バックスラッシュ", value: "\\" },
];

const MATRIX_INSERT_CASES = CURSOR_CONTEXTS.flatMap((context) => INPUT_TOKENS.map((token) => testCase(
  `matrix-input-${context.id}-${token.id}`,
  context.category ?? "Markdown構文",
  `${context.label}へ${token.label}を入力`,
  `${context.left}${EDITING_CARET_MARKER}${context.right}`,
  token.value,
  `${context.left}${token.value}${context.right}`,
  { type: "insert", text: token.value },
)));

interface SelectionContext extends CursorContext { selected: string }

const SELECTION_CONTEXTS: readonly SelectionContext[] = CURSOR_CONTEXTS.slice(0, 30).map((context, index) => ({
  ...context,
  id: `${context.id}-selection`,
  label: `${context.label}の選択範囲`,
  selected: ["x", "old", "日本", "✅", "text"][index % 5],
}));

const REPLACEMENT_TOKENS = INPUT_TOKENS.slice(0, 12);
const MATRIX_REPLACEMENT_CASES = SELECTION_CONTEXTS.flatMap((context) => REPLACEMENT_TOKENS.map((token) => testCase(
  `matrix-replace-${context.id}-${token.id}`,
  context.category ?? "選択置換",
  `${context.label}を${token.label}で置換`,
  `${context.left}${EDITING_SELECTION_START}${context.selected}${EDITING_SELECTION_END}${context.right}`,
  token.value,
  `${context.left}${token.value}${context.right}`,
  { type: "insert", text: token.value },
)));

const DELETE_UNITS: readonly InputToken[] = [
  { id: "ascii", label: "ASCII", value: "a" },
  { id: "digit", label: "数字", value: "7" },
  { id: "hiragana", label: "ひらがな", value: "あ" },
  { id: "kanji", label: "漢字", value: "漢" },
  { id: "fullwidth", label: "全角英字", value: "Ａ" },
  { id: "emoji", label: "絵文字", value: "✅" },
  { id: "family", label: "ZWJ絵文字", value: "👨‍👩‍👧‍👦" },
  { id: "skin-tone", label: "肌色付き絵文字", value: "👍🏽" },
  { id: "flag", label: "国旗絵文字", value: "🇯🇵" },
  { id: "variation", label: "異体字セレクター付き絵文字", value: "❤️" },
  { id: "keycap", label: "キーキャップ絵文字", value: "1️⃣" },
  { id: "combining", label: "結合アクセント", value: "e\u0301" },
  { id: "combining-kana", label: "結合濁点", value: "か\u3099" },
  { id: "space", label: "空白", value: " " },
  { id: "tab", label: "タブ", value: "\t" },
  { id: "asterisk", label: "Markdown記号", value: "*" },
  { id: "lf", label: "LF改行", value: "\n" },
  { id: "crlf", label: "CRLF改行", value: "\r\n" },
];

const DELETE_CONTEXTS = CURSOR_CONTEXTS.slice(0, 20);
const MATRIX_DELETE_CASES = DELETE_CONTEXTS.flatMap((context) => DELETE_UNITS.flatMap((unit) => [
  testCase(
    `matrix-backspace-${context.id}-${unit.id}`,
    unit.id.includes("emoji") || ["family", "skin-tone", "flag", "variation", "keycap", "combining", "combining-kana"].includes(unit.id) ? "Unicode" : "削除",
    `${context.label}で直前の${unit.label}を削除`,
    `${context.left}${unit.value}${EDITING_CARET_MARKER}${context.right}`,
    "Backspace",
    `${context.left}${context.right}`,
    { type: "backspace" },
  ),
  testCase(
    `matrix-delete-${context.id}-${unit.id}`,
    unit.id.includes("emoji") || ["family", "skin-tone", "flag", "variation", "keycap", "combining", "combining-kana"].includes(unit.id) ? "Unicode" : "削除",
    `${context.label}で直後の${unit.label}を削除`,
    `${context.left}${EDITING_CARET_MARKER}${unit.value}${context.right}`,
    "Delete",
    `${context.left}${context.right}`,
    { type: "delete" },
  ),
]));

const PASTE_VALUES: readonly InputToken[] = [
  { id: "single", label: "単一行", value: "pasted" },
  { id: "japanese", label: "日本語", value: "貼り付け" },
  { id: "emoji", label: "絵文字", value: "✅📌" },
  { id: "lf", label: "LF複数行", value: "one\ntwo" },
  { id: "crlf", label: "CRLF複数行", value: "one\r\ntwo" },
  { id: "markdown", label: "Markdown断片", value: "**bold**" },
  { id: "table", label: "表断片", value: "| a | b |\n| - | - |" },
  { id: "fence", label: "コードフェンス", value: "```text\ncode\n```" },
];

const MATRIX_PASTE_CASES = CURSOR_CONTEXTS.slice(0, 20).flatMap((context) => {
  // この行列のCRLF文書フィクスチャはIDにも明示されている。期待値は
  // 実装関数から生成せず、フィクスチャ側の指定に従って固定する。
  const expectedEnding = context.id.startsWith("crlf-") ? "\r\n" : "\n";
  return PASTE_VALUES.map((value) => {
    const expectedPaste = value.value.replace(/\r\n|\r|\n/g, expectedEnding);
    return testCase(
      `matrix-paste-${context.id}-${value.id}`,
      "貼り付け",
      `${context.label}へ${value.label}を貼り付け`,
      `${context.left}${EDITING_CARET_MARKER}${context.right}`,
      `Ctrl+V: ${value.label}`,
      `${context.left}${expectedPaste}${context.right}`,
      { type: "paste", text: value.value },
    );
  });
});

const STRUCTURAL_EDITING_CASES: readonly EditingTestCase[] = [
  testCase("line-move-middle-up", "行入替", "中間行を1行上へ", "one\nt¦wo\nthree", "Alt+↑", "two\none\nthree", { type: "move-lines", direction: -1 }),
  testCase("line-move-middle-down", "行入替", "中間行を1行下へ", "one\nt¦wo\nthree", "Alt+↓", "one\nthree\ntwo", { type: "move-lines", direction: 1 }),
  testCase("line-move-first-up", "行入替", "先頭行を上へ移動しても変更なし", "fi¦rst\nsecond", "Alt+↑", "first\nsecond", { type: "move-lines", direction: -1 }),
  testCase("line-move-last-down", "行入替", "末尾行を下へ移動しても変更なし", "first\nsec¦ond", "Alt+↓", "first\nsecond", { type: "move-lines", direction: 1 }),
  testCase("line-move-first-down", "行入替", "先頭行を下へ", "fi¦rst\nsecond\nthird", "Alt+↓", "second\nfirst\nthird", { type: "move-lines", direction: 1 }),
  testCase("line-move-last-up", "行入替", "末尾行を上へ", "first\nsecond\nthi¦rd", "Alt+↑", "first\nthird\nsecond", { type: "move-lines", direction: -1 }),
  testCase("line-move-selection-up", "行入替", "選択した2行を上へ", "one\n⟦two\nthree⟧\nfour", "Alt+↑", "two\nthree\none\nfour", { type: "move-lines", direction: -1 }),
  testCase("line-move-selection-down", "行入替", "選択した2行を下へ", "one\n⟦two\nthree⟧\nfour", "Alt+↓", "one\nfour\ntwo\nthree", { type: "move-lines", direction: 1 }),
  testCase("line-move-blank-up", "行入替", "空行を上へ", "one\n¦\ntwo", "Alt+↑", "\none\ntwo", { type: "move-lines", direction: -1 }),
  testCase("line-move-blank-down", "行入替", "空行を下へ", "one\n¦\ntwo", "Alt+↓", "one\ntwo\n", { type: "move-lines", direction: 1 }),
  testCase("line-move-crlf-up", "行入替", "CRLF中間行を上へ", "one\r\nt¦wo\r\nthree", "Alt+↑", "two\r\none\r\nthree", { type: "move-lines", direction: -1 }),
  testCase("line-move-crlf-down", "行入替", "CRLF中間行を下へ", "one\r\nt¦wo\r\nthree", "Alt+↓", "one\r\nthree\r\ntwo", { type: "move-lines", direction: 1 }),
  testCase("line-move-heading", "行入替", "見出し行だけを下へ", "# Hea¦ding\nbody", "Alt+↓", "body\n# Heading", { type: "move-lines", direction: 1 }),
  testCase("line-move-table", "行入替", "表データ行を上へ", "| a |\n| - |\n| t¦wo |\n| three |", "Alt+↑", "| a |\n| two |\n| - |\n| three |", { type: "move-lines", direction: -1 }),
  testCase("line-move-fence-body", "行入替", "コードフェンス本文行を上へ", "```text\none\nt¦wo\n```", "Alt+↑", "```text\ntwo\none\n```", { type: "move-lines", direction: -1 }),

  testCase("cut-paste-line-down", "切り取り・貼り付け", "先頭行を切り取り3行目の前へ貼り付け", "⟦one\n⟧two\n◆three", "Ctrl+X → Ctrl+V", "two\none\nthree", { type: "cut-paste" }),
  testCase("cut-paste-line-up", "切り取り・貼り付け", "中間行を切り取り先頭へ貼り付け", "◆one\n⟦two\n⟧three", "Ctrl+X → Ctrl+V", "two\none\nthree", { type: "cut-paste" }),
  testCase("cut-paste-two-lines-down", "切り取り・貼り付け", "2行を切り取り末尾行の前へ貼り付け", "⟦one\ntwo\n⟧three\n◆four", "Ctrl+X → Ctrl+V", "three\none\ntwo\nfour", { type: "cut-paste" }),
  testCase("cut-paste-two-lines-up", "切り取り・貼り付け", "末尾側2行を切り取り先頭へ貼り付け", "◆one\n⟦two\nthree\n⟧four", "Ctrl+X → Ctrl+V", "two\nthree\none\nfour", { type: "cut-paste" }),
  testCase("cut-paste-word-forward", "切り取り・貼り付け", "単語を後方の空白位置へ移動", "⟦alpha⟧ beta ◆gamma", "Ctrl+X → Ctrl+V", " beta alphagamma", { type: "cut-paste" }),
  testCase("cut-paste-word-backward", "切り取り・貼り付け", "単語を文頭へ移動", "◆alpha beta ⟦gamma⟧", "Ctrl+X → Ctrl+V", "gammaalpha beta ", { type: "cut-paste" }),
  testCase("cut-paste-markdown-bold", "切り取り・貼り付け", "太字構文全体を移動", "before ⟦**bold** ⟧after ◆end", "Ctrl+X → Ctrl+V", "before after **bold** end", { type: "cut-paste" }),
  testCase("cut-paste-link", "切り取り・貼り付け", "リンク構文全体を移動", "◆start [x](a) and ⟦[y](b)⟧", "Ctrl+X → Ctrl+V", "[y](b)start [x](a) and ", { type: "cut-paste" }),
  testCase("cut-paste-list-item", "切り取り・貼り付け", "箇条書き1項目を移動", "- one\n⟦- two\n⟧◆- three", "Ctrl+X → Ctrl+V", "- one\n- two\n- three", { type: "cut-paste" }),
  testCase("cut-paste-crlf", "切り取り・貼り付け", "CRLF行を切り取り貼り付け", "⟦one\r\n⟧two\r\n◆three", "Ctrl+X → Ctrl+V", "two\r\none\r\nthree", { type: "cut-paste" }),
  testCase("cut-paste-code-block", "切り取り・貼り付け", "コードブロック全体を別段落へ移動", "⟦```text\ncode\n```\n\n⟧paragraph\n\n◆tail", "Ctrl+X → Ctrl+V", "paragraph\n\n```text\ncode\n```\n\ntail", { type: "cut-paste" }),

  testCase("heading-move-h1-before", "見出し入替", "H1ブロックを前へ", "# One\nbody 1\n\n# ◆Two\nbody 2\n\n# Th¦ree\nbody 3", "見出しを前へ移動", "# One\nbody 1\n\n# Three\nbody 3# Two\nbody 2\n\n", { type: "move-heading", position: "before" }),
  testCase("heading-move-h1-after", "見出し入替", "H1ブロックを後ろへ", "# O¦ne\nbody 1\n\n# ◆Two\nbody 2\n\n# Three\nbody 3", "見出しを後ろへ移動", "# Two\nbody 2\n\n# One\nbody 1\n\n# Three\nbody 3", { type: "move-heading", position: "after" }),
  testCase("heading-move-with-child", "見出し入替", "子見出しと本文を含むH1ブロックを移動", "# O¦ne\n## Child\nchild body\n\n# ◆Two\ntwo body", "見出しを後ろへ移動", "# Two\ntwo body# One\n## Child\nchild body\n\n", { type: "move-heading", position: "after" }),
  testCase("heading-move-sibling-h2", "見出し入替", "同じ親のH2同士を入れ替え", "# Root\n## O¦ne\none\n## ◆Two\ntwo", "見出しを後ろへ移動", "# Root\n## Two\ntwo## One\none\n", { type: "move-heading", position: "after" }),
  testCase("heading-move-different-parent-noop", "見出し入替", "異なる親のH2は移動不可", "# A\n## O¦ne\n# B\n## ◆Two", "見出しを前へ移動", "# A\n## One\n# B\n## Two", { type: "move-heading", position: "before" }),
  testCase("heading-move-different-level-noop", "見出し入替", "異なるレベルの見出しは移動不可", "# O¦ne\n## ◆Child", "見出しを前へ移動", "# One\n## Child", { type: "move-heading", position: "before" }),
  testCase("heading-move-numbered", "見出し入替", "番号付き見出しを移動して再採番", "# 1. O¦ne\n# 2. ◆Two\n# 3. Three", "見出しを後ろへ移動", "# 1. Two\n# 2. One\n# 3. Three", { type: "move-heading", position: "after" }),
  testCase("heading-move-fenced-heading", "見出し入替", "コードフェンス内の疑似見出しを無視", "# O¦ne\n```text\n# Fake\n```\n# ◆Two", "見出しを後ろへ移動", "# Two# One\n```text\n# Fake\n```\n", { type: "move-heading", position: "after" }),

  testCase("paste-indented-unordered-root", "貼り付け", "インデント済み箇条書きを空のルート項目へ貼り付け", "- ¦", "Ctrl+V:   - child↵    - grandchild", "  - child\n    - grandchild", { type: "paste", text: "  - child\n    - grandchild" }),
  testCase("paste-indented-unordered-child", "貼り付け", "インデント済み箇条書きを空の子項目へ貼り付け", "- parent\n  - ¦", "Ctrl+V:   - child↵    - grandchild", "- parent\n    - child\n      - grandchild", { type: "paste", text: "  - child\n    - grandchild" }),
  testCase("paste-indented-ordered-root", "貼り付け", "インデント済み番号付きリストを貼り付けて再採番", "1. ¦", "Ctrl+V:   8. child↵    4. grandchild", "  1. child\n    1. grandchild", { type: "paste", text: "  8. child\n    4. grandchild" }),
  testCase("paste-indented-task-root", "貼り付け", "インデント済みタスクリストを貼り付け", "- [ ] ¦", "Ctrl+V:   - [x] done↵    - [ ] child", "  - [x] done\n    - [ ] child", { type: "paste", text: "  - [x] done\n    - [ ] child" }),
  testCase("paste-indented-mixed", "貼り付け", "種類が混在するインデント済みリストを貼り付け", "- ¦", "Ctrl+V: - one↵  1. child↵    - [ ] task", "- one\n  1. child\n    - [ ] task", { type: "paste", text: "- one\n  1. child\n    - [ ] task" }),
  testCase("paste-indented-tabs", "貼り付け", "タブでインデントされたリストを貼り付け", "- ¦", "Ctrl+V: ⇥- child↵⇥⇥- grandchild", "\t- child\n\t\t- grandchild", { type: "paste", text: "\t- child\n\t\t- grandchild" }),
  testCase("paste-indented-crlf-target", "貼り付け", "CRLF文書へインデント済みリストを貼り付け", "- parent\r\n  - ¦\r\n- tail", "Ctrl+V:   - a↵    - b", "- parent\r\n    - a\r\n      - b\r\n- tail", { type: "paste", text: "  - a\n    - b" }),
  testCase("paste-indented-with-continuation", "貼り付け", "継続行を含むインデント済みリストを貼り付け", "- ¦", "Ctrl+V:   - child↵      continuation", "  - child\n      continuation", { type: "paste", text: "  - child\n      continuation" }),
  testCase("paste-indented-with-blank", "貼り付け", "空行を含むインデント済みリストを貼り付け", "- ¦", "Ctrl+V: - one↵↵  - child", "- one\n\n  - child", { type: "paste", text: "- one\n\n  - child" }),
  testCase("paste-indented-deep", "貼り付け", "4階層のインデント済みリストを貼り付け", "- ¦", "Ctrl+V: - l1↵  - l2↵    - l3↵      - l4", "- l1\n  - l2\n    - l3\n      - l4", { type: "paste", text: "- l1\n  - l2\n    - l3\n      - l4" }),
];

const LINE_MOVE_CONTENTS = [
  ["alpha", "target", "omega"],
  ["日本語の前", "移動対象", "日本語の後"],
  ["# Heading", "paragraph", "## Child"],
  ["> quote one", "> quote target", "> quote three"],
  ["| header |", "| target |", "| tail |"],
  ["---", "paragraph", "***"],
  ["<!-- before -->", "<!-- target -->", "<!-- after -->"],
  ["<div>", "text", "</div>"],
  ["```text", "code target", "```"],
  ["~~~text", "code target", "~~~"],
  ["[one](a)", "[target](b)", "[three](c)"],
  ["![one](a.png)", "![target](b.png)", "![three](c.png)"],
  ["**bold**", "_target_", "~~strike~~"],
  ["key: one", "target: two", "tail: three"],
  ["C:\\one", "C:\\target", "C:\\three"],
  ["first", "", "third"],
  ["🙂 first", "✅ target", "📌 third"],
  ["[^1]: first", "[^2]: target", "[^3]: third"],
  ["[a]: /one", "[b]: /target", "[c]: /three"],
  ["<https://one>", "<https://target>", "<https://three>"],
  ["    code one", "    code target", "    code three"],
  ["term", ": target definition", "tail"],
  ["$$", "x = target", "$$"],
  ["::: note", "target", ":::"],
  ["before  ", "target  ", "after  "],
] as const;

const LINE_MOVE_MATRIX_CASES = (["\n", "\r\n"] as const).flatMap((ending) => LINE_MOVE_CONTENTS.flatMap(([above, target, below], index) => [
  testCase(
    `matrix-line-move-${ending === "\n" ? "lf" : "crlf"}-${index}-up`,
    "行入替",
    `${index + 1}番目の構文で中間行を上へ移動`,
    `${above}${ending}${target}${EDITING_CARET_MARKER}${ending}${below}`,
    "Alt+↑",
    `${target}${ending}${above}${ending}${below}`,
    { type: "move-lines", direction: -1 },
  ),
  testCase(
    `matrix-line-move-${ending === "\n" ? "lf" : "crlf"}-${index}-down`,
    "行入替",
    `${index + 1}番目の構文で中間行を下へ移動`,
    `${above}${ending}${target}${EDITING_CARET_MARKER}${ending}${below}`,
    "Alt+↓",
    `${above}${ending}${below}${ending}${target}`,
    { type: "move-lines", direction: 1 },
  ),
]));

function buildCutPasteLineCases(ending: "\n" | "\r\n"): EditingTestCase[] {
  const lines = ["alpha", "日本語", "# Heading", "> quote", "| table |", "omega"];
  const cases: EditingTestCase[] = [];
  for (let source = 0; source < lines.length; source += 1) {
    for (let destination = 0; destination < lines.length; destination += 1) {
      if (source === destination) continue;
      const before = lines.map((line, index) => `${index === destination ? EDITING_DESTINATION_MARKER : ""}${index === source ? EDITING_SELECTION_START : ""}${line}${ending}${index === source ? EDITING_SELECTION_END : ""}`).join("");
      const reordered = [...lines];
      const [moved] = reordered.splice(source, 1);
      reordered.splice(destination > source ? destination - 1 : destination, 0, moved);
      cases.push(testCase(
        `matrix-cut-paste-${ending === "\n" ? "lf" : "crlf"}-line-${source}-to-${destination}`,
        "切り取り・貼り付け",
        `${source + 1}行目を切り取り${destination + 1}行目の前へ貼り付け`,
        before,
        "Ctrl+X → Ctrl+V",
        reordered.map((line) => line + ending).join(""),
        { type: "cut-paste" },
      ));
    }
  }
  for (let source = 0; source < lines.length - 1; source += 1) {
    for (let destination = 0; destination < lines.length; destination += 1) {
      if (destination === source || destination === source + 1) continue;
      const before = lines.map((line, index) => `${index === destination ? EDITING_DESTINATION_MARKER : ""}${index === source ? EDITING_SELECTION_START : ""}${line}${ending}${index === source + 1 ? EDITING_SELECTION_END : ""}`).join("");
      const reordered = [...lines];
      const moved = reordered.splice(source, 2);
      reordered.splice(destination > source + 1 ? destination - 2 : destination, 0, ...moved);
      cases.push(testCase(
        `matrix-cut-paste-${ending === "\n" ? "lf" : "crlf"}-block-${source}-to-${destination}`,
        "切り取り・貼り付け",
        `${source + 1}～${source + 2}行目を切り取り${destination + 1}行目の前へ貼り付け`,
        before,
        "Ctrl+X → Ctrl+V",
        reordered.map((line) => line + ending).join(""),
        { type: "cut-paste" },
      ));
    }
  }
  return cases;
}

const CUT_PASTE_MATRIX_CASES = [
  ...buildCutPasteLineCases("\n"),
  ...buildCutPasteLineCases("\r\n"),
];

interface HeadingFixture {
  title: string;
  body: string;
  child?: string;
}

const HEADING_FIXTURES: readonly HeadingFixture[] = [
  { title: "Alpha", body: "alpha body" },
  { title: "日本語", body: "日本語本文" },
  { title: "Images", body: "![image](a.png)" },
  { title: "Code", body: "```text\ncode\n```" },
  { title: "Parent", body: "parent body", child: "Child" },
  { title: "Final", body: "final body" },
];

function headingBlock(fixture: HeadingFixture, ending: string, source: boolean, target: boolean): string {
  const heading = `# ${target ? EDITING_DESTINATION_MARKER : ""}${fixture.title}${source ? EDITING_CARET_MARKER : ""}`;
  const child = fixture.child ? `${ending}## ${fixture.child}${ending}child body` : "";
  return `${heading}${ending}${fixture.body}${child}${ending}${ending}`;
}

function plainHeadingBlock(fixture: HeadingFixture, ending: string): string {
  const child = fixture.child ? `${ending}## ${fixture.child}${ending}child body` : "";
  return `# ${fixture.title}${ending}${fixture.body}${child}${ending}${ending}`;
}

function buildHeadingMoveCases(ending: "\n" | "\r\n"): EditingTestCase[] {
  const cases: EditingTestCase[] = [];
  for (let source = 0; source < HEADING_FIXTURES.length; source += 1) {
    for (let target = 0; target < HEADING_FIXTURES.length; target += 1) {
      if (source === target) continue;
      for (const position of ["before", "after"] as const) {
        const before = HEADING_FIXTURES.map((fixture, index) => headingBlock(fixture, ending, index === source, index === target)).join("");
        const reordered = [...HEADING_FIXTURES];
        const [moved] = reordered.splice(source, 1);
        const targetAfterRemoval = reordered.findIndex((fixture) => fixture === HEADING_FIXTURES[target]);
        reordered.splice(targetAfterRemoval + (position === "after" ? 1 : 0), 0, moved);
        cases.push(testCase(
          `matrix-heading-${ending === "\n" ? "lf" : "crlf"}-${source}-${position}-${target}`,
          "見出し入替",
          `${HEADING_FIXTURES[source].title}見出しブロックを${HEADING_FIXTURES[target].title}の${position === "before" ? "前" : "後"}へ移動`,
          before,
          `見出しを${position === "before" ? "前" : "後"}へ移動`,
          reordered.map((fixture) => plainHeadingBlock(fixture, ending)).join(""),
          { type: "move-heading", position },
        ));
      }
    }
  }
  return cases;
}

const HEADING_MOVE_MATRIX_CASES = [
  ...buildHeadingMoveCases("\n"),
  ...buildHeadingMoveCases("\r\n"),
];

interface ListPasteTarget {
  id: string;
  prefix: string;
  indent: string;
  suffix: string;
}

const LIST_PASTE_TARGETS: readonly ListPasteTarget[] = [
  { id: "root-unordered", prefix: "", indent: "", suffix: "" },
  { id: "child-unordered", prefix: "- parent\n", indent: "  ", suffix: "" },
  { id: "grandchild-unordered", prefix: "- root\n  - parent\n", indent: "    ", suffix: "" },
  { id: "root-task", prefix: "", indent: "", suffix: "" },
  { id: "child-task", prefix: "- [ ] parent\n", indent: "  ", suffix: "" },
  { id: "between-items", prefix: "- before\n", indent: "  ", suffix: "\n- after" },
];

const INDENTED_LIST_FIXTURES = [
  "- alpha\n  - child",
  "- alpha\n    - deep",
  "  - indented\n    - child",
  "- [ ] task\n  - [x] done",
  "- [x] done\n    - [ ] child",
  "1. first\n2. second",
  "1) first\n2) second",
  "- parent\n  1. ordered\n  2. ordered two",
  "1. parent\n  - child\n    - grandchild",
  "- one\n\n  - child",
  "- one\n    continuation",
  "\t- tab child\n\t\t- tab grandchild",
  "- 日本語\n  - 子項目",
  "- emoji ✅\n  - emoji 📌",
  "- link [x](a)\n  - image ![a](a.png)",
  "- `code`\n  - **bold**",
  "- level1\n  - level2\n    - level3\n      - level4",
  "+ plus\n  * asterisk",
  "1. starts-one\n2. starts-two",
  "- [X] uppercase checked\n  - [ ] open",
] as const;

function normalizePastedFixtureLineEndings(value: string, ending: string): string {
  return value.replace(/\r\n|\r|\n/g, ending);
}

function buildIndentedListPasteCases(ending: "\n" | "\r\n"): EditingTestCase[] {
  return LIST_PASTE_TARGETS.flatMap((target) => INDENTED_LIST_FIXTURES.map((fixture, index) => {
    const normalizedFixture = normalizePastedFixtureLineEndings(fixture, ending);
    const pastedLines = normalizedFixture.split(ending).map((line) => target.indent + line).join(ending);
    const emptyMarker = target.id.includes("task") ? "- [ ] " : target.id === "between-items" ? "- " : "- ";
    const suffix = target.suffix || (ending === "\r\n" ? "\n- tail" : "");
    const source = normalizePastedFixtureLineEndings(target.prefix, ending) + target.indent + emptyMarker + EDITING_CARET_MARKER + normalizePastedFixtureLineEndings(suffix, ending);
    const expected = normalizePastedFixtureLineEndings(target.prefix, ending) + pastedLines + normalizePastedFixtureLineEndings(suffix, ending);
    return testCase(
      `matrix-indented-paste-${ending === "\n" ? "lf" : "crlf"}-${target.id}-${index}`,
      "貼り付け",
      `${target.id}へインデント済みリストパターン${index + 1}を貼り付け`,
      source,
      `Ctrl+V: インデント済みリスト${index + 1}`,
      expected,
      { type: "paste", text: fixture },
    );
  }));
}

const INDENTED_LIST_PASTE_MATRIX_CASES = [
  ...buildIndentedListPasteCases("\n"),
  ...buildIndentedListPasteCases("\r\n"),
];

const HISTORY_CASES: readonly EditingTestCase[] = [
  ...CURSOR_CONTEXTS.slice(0, 40).flatMap((context, index) => {
    const token = INPUT_TOKENS[index % INPUT_TOKENS.length];
    const before = `${context.left}${EDITING_CARET_MARKER}${context.right}`;
    const edited = `${context.left}${token.value}${context.right}`;
    return [
      testCase(
        `history-insert-${context.id}-undo`,
        "履歴",
        `${context.label}への${token.label}入力を元に戻す`,
        before,
        `${token.value} → Ctrl+Z`,
        `${context.left}${context.right}`,
        { type: "history", insert: token.value, undoCount: 1, redoCount: 0 },
      ),
      testCase(
        `history-insert-${context.id}-redo`,
        "履歴",
        `${context.label}への${token.label}入力を元に戻してやり直す`,
        before,
        `${token.value} → Ctrl+Z → Ctrl+Y`,
        edited,
        { type: "history", insert: token.value, undoCount: 1, redoCount: 1 },
      ),
    ];
  }),
  ...SELECTION_CONTEXTS.slice(0, 20).flatMap((context, index) => {
    const token = REPLACEMENT_TOKENS[index % REPLACEMENT_TOKENS.length];
    const before = `${context.left}${EDITING_SELECTION_START}${context.selected}${EDITING_SELECTION_END}${context.right}`;
    return [
      testCase(
        `history-replace-${context.id}-undo`,
        "履歴",
        `${context.label}の置換を元に戻す`,
        before,
        `${token.value} → Ctrl+Z`,
        `${context.left}${context.selected}${context.right}`,
        { type: "history", insert: token.value, undoCount: 1, redoCount: 0 },
      ),
      testCase(
        `history-replace-${context.id}-redo`,
        "履歴",
        `${context.label}の置換を元に戻してやり直す`,
        before,
        `${token.value} → Ctrl+Z → Ctrl+Y`,
        `${context.left}${token.value}${context.right}`,
        { type: "history", insert: token.value, undoCount: 1, redoCount: 1 },
      ),
    ];
  }),
];

const SPECIAL_CURSOR_CONTEXTS: readonly CursorContext[] = [
  { id: "bom-start", label: "BOM直後", left: "\uFEFF", right: "text", category: "特殊文字" },
  { id: "nul-around", label: "NUL文字の間", left: "before\0", right: "after", category: "特殊文字" },
  { id: "rtl-arabic", label: "アラビア語中央", left: "مرح", right: "با", category: "Unicode" },
  { id: "rtl-hebrew", label: "ヘブライ語中央", left: "של", right: "ום", category: "Unicode" },
  { id: "bidi-control", label: "双方向制御文字の内側", left: "A\u202E", right: "B\u202C", category: "特殊文字" },
  { id: "supplementary-kanji", label: "補助漢字の間", left: "𠮷", right: "野家", category: "Unicode" },
  { id: "devanagari", label: "デーヴァナーガリー中央", left: "नम", right: "स्ते", category: "Unicode" },
  { id: "thai", label: "タイ語中央", left: "สวั", right: "สดี", category: "Unicode" },
  { id: "hangul-jamo", label: "ハングル字母の間", left: "하", right: "ᆫ", category: "Unicode" },
  { id: "variation-selector", label: "異体字セレクターの後", left: "❤️", right: "text", category: "Unicode" },
  { id: "zwj-family", label: "ZWJ絵文字の後", left: "👨‍👩‍👧‍👦", right: "family", category: "Unicode" },
  { id: "regional-flags", label: "国旗絵文字の間", left: "🇯🇵", right: "🇺🇸", category: "Unicode" },
  { id: "combining-stack", label: "複数結合文字の後", left: "a\u0301\u0327", right: "b", category: "Unicode" },
  { id: "zero-width-space", label: "ゼロ幅空白の後", left: "a\u200B", right: "b", category: "特殊文字" },
  { id: "word-joiner", label: "word joinerの後", left: "a\u2060", right: "b", category: "特殊文字" },
  { id: "non-breaking-space", label: "改行不可空白の後", left: "a\u00A0", right: "b", category: "特殊文字" },
  { id: "line-separator", label: "Unicode行区切りの後", left: "a\u2028", right: "b", category: "特殊文字" },
  { id: "paragraph-separator", label: "Unicode段落区切りの後", left: "a\u2029", right: "b", category: "特殊文字" },
  { id: "trailing-spaces", label: "行末2空白の間", left: "text ", right: " \nnext", category: "境界値" },
  { id: "empty-last-line", label: "末尾空行", left: "text\n", right: "", category: "境界値" },
  { id: "mixed-lf-crlf", label: "LFとCRLF混在位置", left: "one\ntwo\r\n", right: "three", category: "境界値" },
  { id: "mixed-cr-lf", label: "CRとLF混在位置", left: "one\rtwo\n", right: "three", category: "境界値" },
  { id: "atx-closing", label: "閉じハッシュ付き見出し", left: "# Heading ", right: "###", category: "Markdown構文" },
  { id: "escaped-link", label: "エスケープを含むリンク", left: "[a\\]b](ur", right: "l)", category: "Markdown構文" },
  { id: "nested-emphasis", label: "入れ子強調", left: "***bo", right: "ld***", category: "Markdown構文" },
];

const SPECIAL_INPUT_TOKENS = INPUT_TOKENS.slice(0, 12);
const SPECIAL_CHARACTER_CASES = SPECIAL_CURSOR_CONTEXTS.flatMap((context) => SPECIAL_INPUT_TOKENS.map((token) => testCase(
  `imagined-special-${context.id}-${token.id}`,
  context.category ?? "特殊文字",
  `${context.label}へ${token.label}を入力する想定`,
  `${context.left}${EDITING_CARET_MARKER}${context.right}`,
  token.value,
  `${context.left}${token.value}${context.right}`,
  { type: "insert", text: token.value },
)));

interface ListEnterMarker {
  id: string;
  marker: string;
  firstMarker: string;
  nextMarker: string;
  taskPrefix?: string;
  nextTaskPrefix?: string;
}

const LIST_ENTER_MARKERS: readonly ListEnterMarker[] = [
  { id: "dash", marker: "-", firstMarker: "-", nextMarker: "-" },
  { id: "plus", marker: "+", firstMarker: "+", nextMarker: "+" },
  { id: "asterisk", marker: "*", firstMarker: "*", nextMarker: "*" },
  { id: "ordered-dot", marker: "7.", firstMarker: "1.", nextMarker: "2." },
  { id: "ordered-paren", marker: "7)", firstMarker: "1)", nextMarker: "2)" },
  { id: "task-open", marker: "-", firstMarker: "-", nextMarker: "-", taskPrefix: "[ ] ", nextTaskPrefix: "[ ] " },
  { id: "task-done", marker: "-", firstMarker: "-", nextMarker: "-", taskPrefix: "[x] ", nextTaskPrefix: "[ ] " },
];

const LIST_ENTER_INDENTS = ["", "  ", "    ", "\t"] as const;
const LIST_ENTER_BODIES = ["text", "日本語", "**bold**", "[link](url)", "`code`", "✅", "a  b", "trailing  ", "- nested-like", "1. number-like"] as const;

const IMAGINED_LIST_ENTER_CASES = (["\n", "\r\n"] as const).flatMap((ending) => LIST_ENTER_MARKERS.flatMap((marker) => LIST_ENTER_INDENTS.flatMap((indent, indentIndex) => LIST_ENTER_BODIES.map((body, bodyIndex) => {
  const suffix = `${ending}tail`;
  const beforeLine = `${indent}${marker.marker} ${marker.taskPrefix ?? ""}${body}${EDITING_CARET_MARKER}`;
  const firstLine = `${indent}${marker.firstMarker} ${marker.taskPrefix ?? ""}${body}`;
  const nextLine = `${indent}${marker.nextMarker} ${marker.nextTaskPrefix ?? ""}`;
  return testCase(
    `imagined-list-enter-${ending === "\n" ? "lf" : "crlf"}-${marker.id}-${indentIndex}-${bodyIndex}`,
    "改行",
    `${marker.id}の深さ${indentIndex}・本文パターン${bodyIndex + 1}をEnterで継続`,
    beforeLine + suffix,
    "Enter",
    `${firstLine}${ending}${nextLine}${suffix}`,
    { type: "enter" },
  );
}))));

const LARGE_BOUNDARY_CASES: readonly EditingTestCase[] = [10, 100, 1000, 10000].flatMap((length) => {
  const source = "a".repeat(length);
  const middle = Math.floor(length / 2);
  return [
    testCase(`large-${length}-insert-start`, "境界値", `${length}文字文書の先頭へ入力`, `${EDITING_CARET_MARKER}${source}`, "X", `X${source}`, { type: "insert", text: "X" }),
    testCase(`large-${length}-insert-middle`, "境界値", `${length}文字文書の中央へ入力`, `${source.slice(0, middle)}${EDITING_CARET_MARKER}${source.slice(middle)}`, "X", `${source.slice(0, middle)}X${source.slice(middle)}`, { type: "insert", text: "X" }),
    testCase(`large-${length}-insert-end`, "境界値", `${length}文字文書の末尾へ入力`, `${source}${EDITING_CARET_MARKER}`, "X", `${source}X`, { type: "insert", text: "X" }),
    testCase(`large-${length}-replace-all`, "境界値", `${length}文字文書全体を置換`, `${EDITING_SELECTION_START}${source}${EDITING_SELECTION_END}`, "replaced", "replaced", { type: "insert", text: "replaced" }),
    testCase(`large-${length}-delete-middle`, "境界値", `${length}文字文書中央の1文字を削除`, `${source.slice(0, middle)}${EDITING_CARET_MARKER}${source.slice(middle)}`, "Delete", source.slice(0, -1), { type: "delete" }),
  ];
});

const IMAGINED_CUT_EDGE_CASES: readonly EditingTestCase[] = [
  testCase("imagined-cut-empty-selection", "切り取り・貼り付け", "空選択の切り取り貼り付け", `a${EDITING_SELECTION_START}${EDITING_SELECTION_END}b${EDITING_DESTINATION_MARKER}c`, "Ctrl+X → Ctrl+V", "abc", { type: "cut-paste" }),
  testCase("imagined-cut-destination-inside", "切り取り・貼り付け", "選択範囲内を貼り付け先に指定", `a${EDITING_SELECTION_START}b${EDITING_DESTINATION_MARKER}c${EDITING_SELECTION_END}d`, "Ctrl+X → Ctrl+V", "abcd", { type: "cut-paste" }),
  testCase("imagined-cut-bom", "切り取り・貼り付け", "BOMを残して本文を移動", `\uFEFF${EDITING_DESTINATION_MARKER}one ${EDITING_SELECTION_START}two${EDITING_SELECTION_END}`, "Ctrl+X → Ctrl+V", "\uFEFFtwoone ", { type: "cut-paste" }),
  testCase("imagined-cut-rtl", "切り取り・貼り付け", "RTL文字列を移動", `${EDITING_DESTINATION_MARKER}שלום ${EDITING_SELECTION_START}مرحبا${EDITING_SELECTION_END}`, "Ctrl+X → Ctrl+V", "مرحباשלום ", { type: "cut-paste" }),
  testCase("imagined-cut-emoji", "切り取り・貼り付け", "複合絵文字を移動", `${EDITING_SELECTION_START}👨‍👩‍👧‍👦${EDITING_SELECTION_END} family ${EDITING_DESTINATION_MARKER}end`, "Ctrl+X → Ctrl+V", " family 👨‍👩‍👧‍👦end", { type: "cut-paste" }),
  testCase("imagined-cut-final-newline", "切り取り・貼り付け", "末尾改行を含む行を移動", `${EDITING_SELECTION_START}one\n${EDITING_SELECTION_END}${EDITING_DESTINATION_MARKER}two\n`, "Ctrl+X → Ctrl+V", "one\ntwo\n", { type: "cut-paste" }),
];

export const EDITING_TEST_CASES: readonly EditingTestCase[] = [
  ...BASE_EDITING_TEST_CASES,
  ...MATRIX_INSERT_CASES,
  ...MATRIX_REPLACEMENT_CASES,
  ...MATRIX_DELETE_CASES,
  ...MATRIX_PASTE_CASES,
  ...STRUCTURAL_EDITING_CASES,
  ...LINE_MOVE_MATRIX_CASES,
  ...CUT_PASTE_MATRIX_CASES,
  ...HEADING_MOVE_MATRIX_CASES,
  ...INDENTED_LIST_PASTE_MATRIX_CASES,
  ...HISTORY_CASES,
  ...SPECIAL_CHARACTER_CASES,
  ...IMAGINED_LIST_ENTER_CASES,
  ...LARGE_BOUNDARY_CASES,
  ...IMAGINED_CUT_EDGE_CASES,
];
