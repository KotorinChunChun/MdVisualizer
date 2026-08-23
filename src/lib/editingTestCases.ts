import {
  buildMarkdownEdit,
  buildOrderedListNormalization,
  buildStructuredListEnter,
  buildStructuredListIndent,
  buildStructuredListMove,
  buildStructuredListPaste,
  buildStructuredListSoftEnter,
  buildStructuredListToggle,
  type MarkdownEditAction,
  type MarkdownEditChange,
  type StructuredListKind,
} from "./markdownEditing";

export const EDITING_CARET_MARKER = "¦";
export const EDITING_SELECTION_START = "⟦";
export const EDITING_SELECTION_END = "⟧";

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
  | "自動正規化";

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
  | { type: "normalize" };

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
}

function parseAnnotatedText(value: string): ParsedAnnotatedText {
  const caret = value.indexOf(EDITING_CARET_MARKER);
  const selectionStart = value.indexOf(EDITING_SELECTION_START);
  const selectionEnd = value.indexOf(EDITING_SELECTION_END);
  if (caret >= 0) {
    if (value.indexOf(EDITING_CARET_MARKER, caret + 1) >= 0 || selectionStart >= 0 || selectionEnd >= 0) {
      throw new Error("カーソル目印は1個だけ指定してください。");
    }
    return { text: value.slice(0, caret) + value.slice(caret + EDITING_CARET_MARKER.length), from: caret, to: caret };
  }
  if (selectionStart >= 0 && selectionEnd > selectionStart) {
    const text = value.slice(0, selectionStart)
      + value.slice(selectionStart + EDITING_SELECTION_START.length, selectionEnd)
      + value.slice(selectionEnd + EDITING_SELECTION_END.length);
    return {
      text,
      from: selectionStart,
      to: selectionEnd - EDITING_SELECTION_START.length,
    };
  }
  throw new Error("入力前テキストには¦または⟦選択範囲⟧を指定してください。");
}

function applyChange(source: string, change: MarkdownEditChange | null): string {
  if (!change) return source;
  return source.slice(0, change.from) + change.insert + source.slice(change.to);
}

function previousCharacterStart(source: string, position: number): number {
  if (position >= 2 && source.slice(position - 2, position) === "\r\n") return position - 2;
  const points = Array.from(source.slice(0, position));
  return position - (points[points.length - 1]?.length ?? 0);
}

function nextCharacterEnd(source: string, position: number): number {
  if (source.slice(position, position + 2) === "\r\n") return position + 2;
  return position + (Array.from(source.slice(position))[0]?.length ?? 0);
}

function replaceRange(source: string, from: number, to: number, insert: string): string {
  return source.slice(0, from) + insert + source.slice(to);
}

function documentLineEnding(source: string): string {
  return source.includes("\r\n") ? "\r\n" : source.includes("\r") ? "\r" : "\n";
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
    : buildMarkdownEdit(source, from, to, action);
}

export function executeEditingTestCase(testCase: EditingTestCase): EditingTestResult {
  try {
    const { text: source, from, to } = parseAnnotatedText(testCase.before);
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
        const structured = buildStructuredListPaste(source, from, to, testCase.operation.text);
        actualAfter = structured
          ? applyChange(source, structured)
          : replaceRange(source, from, to, testCase.operation.text);
        break;
      }
      case "toolbar":
        actualAfter = applyChange(source, toolbarChange(source, from, to, testCase.operation.action));
        break;
      case "normalize":
        actualAfter = applyChange(source, buildOrderedListNormalization(source, from, to));
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

export const EDITING_TEST_CASES: readonly EditingTestCase[] = [
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

  testCase("normalize-ordered", "自動正規化", "番号付きリストを1から再採番", "4. one\n9. t¦wo\n2. three", "自動再採番", "1. one\n2. two\n3. three", { type: "normalize" }),
  testCase("normalize-nested", "自動正規化", "階層ごとに再採番", "8. one\n   7. ch¦ild\n4. two", "自動再採番", "1. one\n   1. child\n2. two", { type: "normalize" }),
  testCase("normalize-parenthesis", "自動正規化", "丸括弧番号を維持して再採番", "8) one\n3) t¦wo", "自動再採番", "1) one\n2) two", { type: "normalize" }),
  testCase("normalize-heading", "自動正規化", "番号付き見出しを兄弟順に再採番", "# 8. One\n# 3. T¦wo", "自動再採番", "# 1. One\n# 2. Two", { type: "normalize" }),
  testCase("normalize-fence-guard", "自動正規化", "コードフェンス内の番号は変更しない", "```text\n9. it¦em\n```", "自動再採番", "```text\n9. item\n```", { type: "normalize" }),
  testCase("normalize-separated", "自動正規化", "段落で分離したリストは個別に1から開始", "5. one\n\ntext\n\n8. t¦wo", "自動再採番", "1. one\n\ntext\n\n1. two", { type: "normalize" }),
];
