type HastNode = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

import { nextHeadingId } from "./headingIds";

/** Commands understood by every rendered fold section. */
export type FoldCommandName =
  | "collapse"
  | "expand"
  | "toggle"
  | "h1-only"
  | "through-h2"
  | "through-h3"
  | "except-current"
  | "reset";

export interface FoldCommand {
  command: FoldCommandName;
  /** Required for `except-current`; omitted values are resolved from focus. */
  currentFoldId?: string;
}

export const FOLD_COMMAND_EVENT = "markdown-fold-command";

/**
 * Resolves a whole-document toggle without relying on the currently focused
 * heading.  `true` means a section is collapsed.
 */
export function resolveFoldToggle(collapsedStates: readonly boolean[]): "collapse" | "expand" {
  return collapsedStates.length > 0 && collapsedStates.every(Boolean) ? "expand" : "collapse";
}

export function resolveCurrentFoldId(documentRoot: Document = document): string | undefined {
  const section = documentRoot.activeElement?.closest<HTMLElement>("[data-fold-id]");
  return section?.dataset.foldId || undefined;
}

/**
 * Sends a normalized command to all fold sections.  Existing callers may
 * continue to dispatch the legacy string detail directly.
 */
export function dispatchFoldCommand(command: FoldCommandName, documentRoot: Document = document): FoldCommandName {
  const toggles = [...documentRoot.querySelectorAll<HTMLButtonElement>(".fold-toggle")];
  const resolved = command === "toggle"
    ? resolveFoldToggle(toggles.map((toggle) => toggle.getAttribute("aria-expanded") === "false"))
    : command;
  const detail: FoldCommand = {
    command: resolved,
    ...(resolved === "except-current" ? { currentFoldId: resolveCurrentFoldId(documentRoot) } : {}),
  };
  documentRoot.defaultView?.dispatchEvent(new CustomEvent<FoldCommand>(FOLD_COMMAND_EVENT, { detail }));
  return resolved;
}

/** Returns the persisted collapsed value a particular heading should receive. */
export function collapsedForFoldCommand(
  detail: FoldCommand | FoldCommandName,
  level: number,
  foldId: string,
): boolean | undefined {
  const command = typeof detail === "string" ? detail : detail.command;
  switch (command) {
    case "collapse":
      return true;
    case "expand":
    case "reset":
      return false;
    case "h1-only":
      return level !== 1;
    case "through-h2":
      return level > 2;
    case "through-h3":
      return level > 3;
    case "except-current":
      return foldId !== (typeof detail === "string" ? undefined : detail.currentFoldId);
    default:
      return undefined;
  }
}

function textContent(node: HastNode): string {
  if (typeof (node as HastNode & { value?: unknown }).value === "string") return (node as HastNode & { value: string }).value;
  return node.children?.map(textContent).join("") ?? "";
}

const headingLevel = (node: HastNode): number | null => {
  const match = node.type === "element" && node.tagName?.match(/^h([1-6])$/);
  return match ? Number(match[1]) : null;
};

function foldRange(nodes: HastNode[], ids = new Map<string, number>()): HastNode[] {
  const result: HastNode[] = [];
  let index = 0;

  while (index < nodes.length) {
    const heading = nodes[index];
    const level = headingLevel(heading);
    if (!level) {
      result.push(heading);
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < nodes.length) {
      const nextLevel = headingLevel(nodes[end]);
      if (nextLevel !== null && nextLevel <= level) break;
      end += 1;
    }

    const foldId = nextHeadingId(ids, textContent(heading));
    result.push({
      type: "element",
      tagName: "section",
      properties: { className: ["fold-section"], "data-fold-level": level, "data-fold-id": foldId },
      children: [
        { ...heading, properties: { ...heading.properties, className: ["fold-heading"] } },
        {
          type: "element",
          tagName: "div",
          properties: { className: ["fold-content"] },
          children: foldRange(nodes.slice(index + 1, end), ids),
        },
      ],
    });
    index = end;
  }

  return result;
}

/** Groups heading-delimited HAST siblings into collapsible section elements. */
export function rehypeFoldSections() {
  return (tree: HastNode) => {
    if (tree.children) tree.children = foldRange(tree.children);
  };
}

/** Returns parent fold IDs from nearest to farthest for a folded section. */
export function ancestorFoldIds(section: Element): string[] {
  const ids: string[] = [];
  let ancestor = section.parentElement?.closest<HTMLElement>("[data-fold-id]") ?? null;
  while (ancestor) {
    if (ancestor.dataset.foldId) ids.push(ancestor.dataset.foldId);
    ancestor = ancestor.parentElement?.closest<HTMLElement>("[data-fold-id]") ?? null;
  }
  return ids;
}

export const __test__ = { foldRange };
