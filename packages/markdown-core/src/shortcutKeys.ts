export type ShortcutKeyTokenKind = "modifier" | "key";

export interface ShortcutKeyToken {
  label: string;
  kind: ShortcutKeyTokenKind;
}

export interface ShortcutKeyGroup {
  tokens: ShortcutKeyToken[];
}

export interface ShortcutKeySequence {
  groups: ShortcutKeyGroup[];
  separators: string[];
  label: string;
}

export interface ShortcutKeySvgOptions {
  variant?: "inline" | "block";
}

const modifierAliases = new Map<string, string>([
  ["ctrl", "Ctrl"], ["control", "Ctrl"],
  ["shift", "Shift"],
  ["alt", "Alt"], ["option", "Alt"],
  ["windows", "Windows"], ["window", "Windows"], ["win", "Windows"],
  ["meta", "Windows"], ["command", "Windows"], ["cmd", "Windows"],
  ["fn", "Fn"], ["function", "Fn"],
]);

const namedKeyAliases = new Map<string, string>([
  ["enter", "Enter"], ["return", "Enter"],
  ["esc", "Esc"], ["escape", "Esc"],
  ["tab", "Tab"], ["backspace", "Backspace"], ["delete", "Delete"],
  ["insert", "Insert"], ["home", "Home"], ["end", "End"],
  ["pageup", "PageUp"], ["pagedown", "PageDown"],
  ["space", "Space"], ["capslock", "CapsLock"], ["numlock", "NumLock"],
  ["printscreen", "PrintScreen"], ["scrolllock", "ScrollLock"],
  ["pause", "Pause"], ["up", "↑"], ["arrowup", "↑"],
  ["down", "↓"], ["arrowdown", "↓"], ["left", "←"], ["arrowleft", "←"],
  ["right", "→"], ["arrowright", "→"],
  ["↑", "↑"], ["↓", "↓"], ["←", "←"], ["→", "→"],
]);

function compactToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function normalizeShortcutKeyToken(value: string): ShortcutKeyToken | null {
  const source = value.trim();
  if (!source) return null;
  const compact = compactToken(source);
  const modifier = modifierAliases.get(compact);
  if (modifier) return { label: modifier, kind: "modifier" };
  const named = namedKeyAliases.get(compact);
  if (named) return { label: named, kind: "key" };
  if (/^f(?:[1-9]|1[0-2])$/i.test(source)) return { label: source.toUpperCase(), kind: "key" };
  if (/^[a-z0-9]$/i.test(source)) return { label: source.toUpperCase(), kind: "key" };
  if (source.length <= 32 && !/[+\r\n→]/.test(source)) return { label: source, kind: "key" };
  return null;
}

function splitShortcutGroup(group: string): Array<ShortcutKeyToken | null> {
  const plusKey = /\+\s*\+$/.test(group);
  const normalized = plusKey ? group.replace(/\+\s*\+$/, "+__PLUS_KEY__") : group;
  return normalized.split(/\s*\+\s*/).map((value) => value === "__PLUS_KEY__"
    ? { label: "+", kind: "key" as const }
    : normalizeShortcutKeyToken(value));
}

function splitShortcutSequence(source: string): { groups: string[]; separators: string[] } {
  const normalized = source.replace(/\r\n?/g, "\n").replace(/\s*->\s*/g, "→").trim();
  const groups: string[] = [];
  const separators: string[] = [];
  const separatorPattern = /\s*((?<!\+),|(?<!\+)→|\n+)\s*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = separatorPattern.exec(normalized))) {
    const group = normalized.slice(lastIndex, match.index).trim();
    if (group) groups.push(group);
    separators.push(match[1] === "," ? "," : "→");
    lastIndex = separatorPattern.lastIndex;
  }
  const finalGroup = normalized.slice(lastIndex).trim();
  if (finalGroup) groups.push(finalGroup);
  while (separators.length > Math.max(0, groups.length - 1)) separators.pop();
  while (separators.length < Math.max(0, groups.length - 1)) separators.push("→");
  return { groups, separators };
}

export function parseShortcutKeySequence(source: string): ShortcutKeySequence | null {
  const parts = splitShortcutSequence(source);
  if (parts.groups.length === 0) return null;
  const groups: ShortcutKeyGroup[] = [];
  for (const group of parts.groups) {
    const tokens = splitShortcutGroup(group);
    if (tokens.some(token => token === null)) return null;
    groups.push({ tokens: tokens as ShortcutKeyToken[] });
  }
  const label = groups.map((group, index) => {
    const value = group.tokens.map(token => token.label).join(" + ");
    return index < parts.separators.length ? `${value} ${parts.separators[index]} ` : value;
  }).join("");
  return { groups, separators: parts.separators, label };
}

export function isShortcutKeySource(source: string): boolean {
  const parsed = parseShortcutKeySequence(source);
  return parsed?.groups[0]?.tokens[0]?.kind === "modifier";
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}

function rounded(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function estimateLabelWidth(label: string, fontSize: number, padding: number): number {
  const wideCharacters = [...label].filter(character => character.charCodeAt(0) > 0xff).length;
  const narrowCharacters = label.length - wideCharacters;
  const estimatedTextWidth = wideCharacters * fontSize * 0.9 + narrowCharacters * fontSize * 0.63;
  return Math.max(fontSize * 2.1, estimatedTextWidth + padding * 2);
}

function fallbackSequence(source: string): ShortcutKeySequence {
  const label = source.trim() || "Key";
  return { groups: [{ tokens: [{ label, kind: "key" }] }], separators: [], label };
}

export function buildShortcutKeySvg(source: string, options: ShortcutKeySvgOptions = {}): string {
  const variant = options.variant ?? "block";
  const inline = variant === "inline";
  const parsed = parseShortcutKeySequence(source) ?? fallbackSequence(source);
  const keyHeight = inline ? 29 : 44;
  const keyDepth = inline ? 3 : 5;
  const fontSize = inline ? 12 : 17;
  const keyPadding = inline ? 8 : 13;
  const keyGap = inline ? 4 : 7;
  const groupPadding = inline ? 5 : 8;
  const outerPadding = inline ? 2 : 4;
  const separatorGap = inline ? 7 : 12;
  const radius = inline ? 5 : 8;
  const groupHeight = keyHeight + keyDepth + groupPadding * 2;
  const keyY = outerPadding + groupPadding;
  const separatorFontSize = fontSize + (inline ? 1 : 3);
  const groups = parsed.groups.map(group => {
    const tokenWidths = group.tokens.map(token => estimateLabelWidth(token.label, fontSize, keyPadding));
    const keysWidth = tokenWidths.reduce((total, width) => total + width, 0) + Math.max(0, tokenWidths.length - 1) * keyGap;
    return { group, tokenWidths, width: keysWidth + groupPadding * 2 };
  });
  const separatorWidths = parsed.separators.map(separator => Math.max(separatorFontSize * 0.75, separator.length * separatorFontSize * 0.58));
  const totalWidth = outerPadding * 2
    + groups.reduce((total, group) => total + group.width, 0)
    + separatorWidths.reduce((total, width) => total + width + separatorGap * 2, 0);
  const totalHeight = outerPadding * 2 + groupHeight;
  const ariaLabel = escapeXml(`キーボードショートカット: ${parsed.label}`);
  const className = `shortcut-key-svg shortcut-key-svg--${variant}`;
  let currentX = outerPadding;
  let body = "";

  groups.forEach((groupLayout, groupIndex) => {
    const groupX = currentX;
    body += `<rect class="shortcut-key-svg__group" x="${rounded(groupX)}" y="${outerPadding}" width="${rounded(groupLayout.width)}" height="${rounded(groupHeight)}" rx="${radius + 5}"/>`;
    let keyX = groupX + groupPadding;
    groupLayout.group.tokens.forEach((token, tokenIndex) => {
      const width = groupLayout.tokenWidths[tokenIndex];
      const textY = keyY + keyHeight * 0.63;
      body += `<g class="shortcut-key-svg__key" data-shortcut-token="${escapeXml(token.label)}">`;
      body += `<rect class="shortcut-key-svg__edge" x="${rounded(keyX)}" y="${rounded(keyY + keyDepth)}" width="${rounded(width)}" height="${keyHeight}" rx="${radius}"/>`;
      body += `<rect class="shortcut-key-svg__face" x="${rounded(keyX)}" y="${rounded(keyY)}" width="${rounded(width)}" height="${keyHeight}" rx="${radius}"/>`;
      body += `<rect class="shortcut-key-svg__highlight" x="${rounded(keyX + 2)}" y="${rounded(keyY + 2)}" width="${rounded(Math.max(0, width - 4))}" height="${Math.max(5, Math.round(keyHeight * 0.32))}" rx="${Math.max(2, radius - 2)}"/>`;
      body += `<text class="shortcut-key-svg__label" x="${rounded(keyX + width / 2)}" y="${rounded(textY)}" text-anchor="middle" font-size="${fontSize}">${escapeXml(token.label)}</text>`;
      body += "</g>";
      keyX += width;
      if (tokenIndex < groupLayout.tokenWidths.length - 1) {
        keyX += keyGap;
        body += `<text class="shortcut-key-svg__separator" x="${rounded(keyX - keyGap / 2)}" y="${rounded(textY)}" text-anchor="middle" font-size="${separatorFontSize}">+</text>`;
      }
    });
    currentX += groupLayout.width;
    if (groupIndex < parsed.separators.length) {
      const separatorWidth = separatorWidths[groupIndex];
      const separator = parsed.separators[groupIndex];
      body += `<text class="shortcut-key-svg__separator" x="${rounded(currentX + separatorGap + separatorWidth / 2)}" y="${rounded(keyY + keyHeight * 0.63)}" text-anchor="middle" font-size="${separatorFontSize}">${escapeXml(separator)}</text>`;
      currentX += separatorGap * 2 + separatorWidth;
    }
  });

  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${ariaLabel}" viewBox="0 0 ${rounded(totalWidth)} ${rounded(totalHeight)}" preserveAspectRatio="xMinYMid meet" data-shortcut-source="${escapeXml(source.trim())}">${body}</svg>`;
}
