/** Creates a stable comparison key for local Windows paths without filesystem I/O. */
export function localPathIdentity(path: string): string {
  const normalized = path.trim().replace(/\//g, "\\");
  if (!normalized) return "";

  const prefix = normalized.startsWith("\\\\")
    ? "\\\\"
    : normalized.match(/^[A-Za-z]:\\/)?.[0] ?? "";
  const body = prefix ? normalized.slice(prefix.length) : normalized;
  const parts: string[] = [];
  for (const part of body.split(/\\+/)) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return `${prefix}${parts.join("\\")}`.replace(/\\+$/, "").toLocaleLowerCase();
}

export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path.trim());
}

