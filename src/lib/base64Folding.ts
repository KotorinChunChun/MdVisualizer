export interface FoldRange { from: number; to: number }

export function findBase64FoldRange(line: string, lineOffset = 0): FoldRange | null {
  const match = /data:image\/(?:png|jpe?g|webp|gif|bmp|avif)(?:;[a-z0-9=._+-]+)*;base64,([a-z0-9+/=]{48,})/i.exec(line);
  if (!match) return null;
  const body = match[1];
  const bodyOffset = match.index + match[0].indexOf(body);
  const keepStart = Math.min(16, body.length);
  const keepEnd = Math.min(12, Math.max(0, body.length - keepStart));
  const from = lineOffset + bodyOffset + keepStart;
  const to = lineOffset + bodyOffset + body.length - keepEnd;
  return to > from ? { from, to } : null;
}
