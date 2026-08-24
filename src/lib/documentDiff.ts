export type DocumentDiffVersionId = "opened" | "storage" | "editing";

export interface DocumentDiffVersion {
  id: DocumentDiffVersionId;
  label: string;
  content: string;
  changedLines: ReadonlySet<number>;
}

export interface DocumentDiffModel {
  mode: "two-way" | "three-way";
  versions: DocumentDiffVersion[];
}

export interface DocumentDiffHunk {
  id: string;
  kind: "add" | "change" | "delete";
  baseStart: number;
  baseEnd: number;
  targetStart: number;
  targetEnd: number;
  targetLines: readonly string[];
}

interface ChangedLinePair {
  base: Set<number>;
  target: Set<number>;
}

function sourceLines(content: string): string[] {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

/** Maps a one-based source line to its corresponding line in another document version. */
export function mapLineBetweenDocuments(sourceContent: string, targetContent: string, sourceLine: number): number {
  const source = sourceLines(sourceContent);
  const target = sourceLines(targetContent);
  const sourceIndex = Math.max(0, Math.min(source.length - 1, Math.round(sourceLine) - 1));
  const targetLastIndex = Math.max(0, target.length - 1);
  let delta = 0;
  for (const hunk of documentDiffHunks(sourceContent, targetContent)) {
    if (sourceIndex < hunk.baseStart) break;
    const sourceSpan = hunk.baseEnd - hunk.baseStart;
    const targetSpan = hunk.targetEnd - hunk.targetStart;
    if (sourceSpan > 0 && sourceIndex < hunk.baseEnd) {
      if (targetSpan === 0) return Math.min(targetLastIndex, hunk.targetStart) + 1;
      const relative = sourceIndex - hunk.baseStart;
      const mapped = hunk.targetStart + Math.min(targetSpan - 1, Math.floor(relative * targetSpan / sourceSpan));
      return Math.max(0, Math.min(targetLastIndex, mapped)) + 1;
    }
    delta += targetSpan - sourceSpan;
  }
  return Math.max(0, Math.min(targetLastIndex, sourceIndex + delta)) + 1;
}

function commonEdgeHunk(baseLines: string[], targetLines: string[]): DocumentDiffHunk[] {
  let prefix = 0;
  while (prefix < baseLines.length && prefix < targetLines.length && baseLines[prefix] === targetLines[prefix]) prefix += 1;
  let baseEnd = baseLines.length;
  let targetEnd = targetLines.length;
  while (baseEnd > prefix && targetEnd > prefix && baseLines[baseEnd - 1] === targetLines[targetEnd - 1]) {
    baseEnd -= 1;
    targetEnd -= 1;
  }
  if (prefix === baseEnd && prefix === targetEnd) return [];
  return [{
    id: `hunk-${prefix}-${baseEnd}-${targetEnd}`,
    kind: prefix === baseEnd ? "add" : prefix === targetEnd ? "delete" : "change",
    baseStart: prefix,
    baseEnd,
    targetStart: prefix,
    targetEnd,
    targetLines: targetLines.slice(prefix, targetEnd),
  }];
}

/** Groups consecutive line additions, changes, and deletions from base to target. */
export function documentDiffHunks(baseContent: string, targetContent: string): DocumentDiffHunk[] {
  if (baseContent === targetContent) return [];
  const baseLines = sourceLines(baseContent);
  const targetLines = sourceLines(targetContent);
  if (baseLines.length * targetLines.length > 2_000_000) return commonEdgeHunk(baseLines, targetLines);
  const lengths = Array.from({ length: baseLines.length + 1 }, () => new Uint32Array(targetLines.length + 1));
  for (let baseIndex = baseLines.length - 1; baseIndex >= 0; baseIndex -= 1) {
    for (let targetIndex = targetLines.length - 1; targetIndex >= 0; targetIndex -= 1) {
      lengths[baseIndex][targetIndex] = baseLines[baseIndex] === targetLines[targetIndex]
        ? lengths[baseIndex + 1][targetIndex + 1] + 1
        : Math.max(lengths[baseIndex + 1][targetIndex], lengths[baseIndex][targetIndex + 1]);
    }
  }
  const hunks: DocumentDiffHunk[] = [];
  let baseIndex = 0;
  let targetIndex = 0;
  while (baseIndex < baseLines.length || targetIndex < targetLines.length) {
    if (baseIndex < baseLines.length && targetIndex < targetLines.length && baseLines[baseIndex] === targetLines[targetIndex]) {
      baseIndex += 1;
      targetIndex += 1;
      continue;
    }
    const baseStart = baseIndex;
    const targetStart = targetIndex;
    while (baseIndex < baseLines.length || targetIndex < targetLines.length) {
      if (baseIndex < baseLines.length && targetIndex < targetLines.length && baseLines[baseIndex] === targetLines[targetIndex]) break;
      if (targetIndex >= targetLines.length || (baseIndex < baseLines.length && lengths[baseIndex + 1][targetIndex] >= lengths[baseIndex][targetIndex + 1])) {
        baseIndex += 1;
      } else {
        targetIndex += 1;
      }
    }
    hunks.push({
      id: `hunk-${baseStart}-${baseIndex}-${targetStart}-${targetIndex}`,
      kind: baseStart === baseIndex ? "add" : targetStart === targetIndex ? "delete" : "change",
      baseStart,
      baseEnd: baseIndex,
      targetStart,
      targetEnd: targetIndex,
      targetLines: targetLines.slice(targetStart, targetIndex),
    });
  }
  return hunks;
}

function mapBaseBoundary(hunks: readonly DocumentDiffHunk[], baseIndex: number, edge: "start" | "end"): number {
  let delta = 0;
  for (const hunk of hunks) {
    if (baseIndex < hunk.baseStart) break;
    if (baseIndex > hunk.baseEnd || (baseIndex === hunk.baseEnd && hunk.baseStart !== hunk.baseEnd)) {
      delta += (hunk.targetEnd - hunk.targetStart) - (hunk.baseEnd - hunk.baseStart);
      continue;
    }
    return edge === "start" ? hunk.targetStart : hunk.targetEnd;
  }
  return baseIndex + delta;
}

/** Applies one storage hunk to the corresponding region in the current edit. */
export function applyStorageHunk(
  openedContent: string,
  editingContent: string,
  hunk: DocumentDiffHunk,
): string {
  const editingLines = sourceLines(editingContent);
  const editingHunks = documentDiffHunks(openedContent, editingContent);
  const from = mapBaseBoundary(editingHunks, hunk.baseStart, "start");
  const to = mapBaseBoundary(editingHunks, hunk.baseEnd, "end");
  const nextLines = [
    ...editingLines.slice(0, from),
    ...hunk.targetLines,
    ...editingLines.slice(to),
  ];
  const separator = editingContent.includes("\r\n") ? "\r\n" : editingContent.includes("\r") ? "\r" : "\n";
  return nextLines.join(separator);
}

/** Returns one-based changed line numbers for both sides of a line diff. */
export function changedLineNumbers(baseContent: string, targetContent: string): ChangedLinePair {
  const baseLines = sourceLines(baseContent);
  const targetLines = sourceLines(targetContent);
  if (baseContent === targetContent) return { base: new Set(), target: new Set() };

  const commonBase = new Set<number>();
  const commonTarget = new Set<number>();
  const cellCount = baseLines.length * targetLines.length;

  if (cellCount <= 2_000_000) {
    const lengths = Array.from({ length: baseLines.length + 1 }, () => new Uint32Array(targetLines.length + 1));
    for (let baseIndex = baseLines.length - 1; baseIndex >= 0; baseIndex -= 1) {
      for (let targetIndex = targetLines.length - 1; targetIndex >= 0; targetIndex -= 1) {
        lengths[baseIndex][targetIndex] = baseLines[baseIndex] === targetLines[targetIndex]
          ? lengths[baseIndex + 1][targetIndex + 1] + 1
          : Math.max(lengths[baseIndex + 1][targetIndex], lengths[baseIndex][targetIndex + 1]);
      }
    }
    let baseIndex = 0;
    let targetIndex = 0;
    while (baseIndex < baseLines.length && targetIndex < targetLines.length) {
      if (baseLines[baseIndex] === targetLines[targetIndex]) {
        commonBase.add(baseIndex + 1);
        commonTarget.add(targetIndex + 1);
        baseIndex += 1;
        targetIndex += 1;
      } else if (lengths[baseIndex + 1][targetIndex] >= lengths[baseIndex][targetIndex + 1]) {
        baseIndex += 1;
      } else {
        targetIndex += 1;
      }
    }
  } else {
    // Avoid quadratic memory for unusually large documents. Stable common
    // prefixes/suffixes remain unmarked; the uncertain middle is highlighted.
    let prefix = 0;
    while (prefix < baseLines.length && prefix < targetLines.length && baseLines[prefix] === targetLines[prefix]) {
      commonBase.add(prefix + 1);
      commonTarget.add(prefix + 1);
      prefix += 1;
    }
    let baseIndex = baseLines.length - 1;
    let targetIndex = targetLines.length - 1;
    while (baseIndex >= prefix && targetIndex >= prefix && baseLines[baseIndex] === targetLines[targetIndex]) {
      commonBase.add(baseIndex + 1);
      commonTarget.add(targetIndex + 1);
      baseIndex -= 1;
      targetIndex -= 1;
    }
  }

  return {
    base: new Set(baseLines.flatMap((_, index) => commonBase.has(index + 1) ? [] : [index + 1])),
    target: new Set(targetLines.flatMap((_, index) => commonTarget.has(index + 1) ? [] : [index + 1])),
  };
}

export function buildDocumentDiff(openedContent: string, storageContent: string, editingContent: string): DocumentDiffModel {
  const editingChanges = changedLineNumbers(openedContent, editingContent);
  if (openedContent === storageContent) {
    return {
      mode: "two-way",
      versions: [
        { id: "opened", label: "開いた時点／ストレージ最新版", content: openedContent, changedLines: editingChanges.base },
        { id: "editing", label: "編集中", content: editingContent, changedLines: editingChanges.target },
      ],
    };
  }

  const storageChanges = changedLineNumbers(openedContent, storageContent);
  return {
    mode: "three-way",
    versions: [
      {
        id: "opened",
        label: "開いた時点",
        content: openedContent,
        changedLines: new Set([...storageChanges.base, ...editingChanges.base]),
      },
      { id: "storage", label: "ストレージ最新版", content: storageContent, changedLines: storageChanges.target },
      { id: "editing", label: "編集中", content: editingContent, changedLines: editingChanges.target },
    ],
  };
}
