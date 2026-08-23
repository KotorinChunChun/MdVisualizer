export interface ShortcutDefinition {
  keys: string;
  description: string;
}

export const SHORTCUTS: ShortcutDefinition[] = [
  { keys: "Ctrl + N", description: "新しい未保存Markdownを作成" },
  { keys: "Ctrl + S", description: "編集中のローカルMarkdownを保存" },
  { keys: "Ctrl + F", description: "文書内を検索" },
  { keys: "Ctrl + P", description: "印刷／PDF" },
  { keys: "F5", description: "文書を再読込" },
  { keys: "Ctrl + + / Ctrl + ;", description: "表示を拡大" },
  { keys: "Ctrl + -", description: "表示を縮小" },
  { keys: "Ctrl + 0", description: "表示倍率を100%に戻す" },
  { keys: "Ctrl + W", description: "現在のタブを閉じる" },
  { keys: "Ctrl + Tab", description: "次のタブへ移動" },
  { keys: "Ctrl + Shift + Tab", description: "前のタブへ移動" },
  { keys: "Ctrl + Shift + T", description: "最後に閉じたタブを復元" },
  { keys: "Alt + ← / マウス戻る", description: "前の表示状態へ戻る" },
  { keys: "Alt + → / マウス進む", description: "次の表示状態へ進む" },
  { keys: "← / →", description: "プレゼンの前／次ページ" },
  { keys: "Ctrl + Alt + T", description: "見出しを一括展開／折りたたみ" },
  { keys: "F11", description: "全画面表示を切り替え" },
  { keys: "Ctrl + ?", description: "このショートカット一覧を表示" },
  { keys: "Esc", description: "検索・プレビュー・ダイアログを閉じる" },
];

export function isZoomInShortcut(event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "metaKey" | "key" | "code">): boolean {
  return event.ctrlKey
    && !event.altKey
    && !event.metaKey
    && (event.key === "+" || event.key === "=" || event.key === ";" || event.code === "Semicolon");
}

export function isShortcutHelpShortcut(event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "metaKey" | "shiftKey" | "key" | "code">): boolean {
  return event.ctrlKey
    && !event.altKey
    && !event.metaKey
    && (event.key === "?" || (event.shiftKey && event.code === "Slash"));
}

export interface AuxiliaryNavigationStamp {
  button: number;
  timestamp: number;
}

export function acceptAuxiliaryNavigation(
  previous: AuxiliaryNavigationStamp,
  button: number,
  timestamp: number,
  duplicateWindowMs = 250,
): { accepted: boolean; next: AuxiliaryNavigationStamp } {
  const duplicate = previous.button === button && timestamp - previous.timestamp >= 0 && timestamp - previous.timestamp < duplicateWindowMs;
  return { accepted: !duplicate, next: duplicate ? previous : { button, timestamp } };
}
