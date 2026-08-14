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

interface ChangedLinePair {
  base: Set<number>;
  target: Set<number>;
}

function sourceLines(content: string): string[] {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
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
