type HastNode = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const headingLevel = (node: HastNode): number | null => {
  const match = node.type === "element" && node.tagName?.match(/^h([1-4])$/);
  return match ? Number(match[1]) : null;
};

function foldRange(nodes: HastNode[]): HastNode[] {
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

    result.push({
      type: "element",
      tagName: "section",
      properties: { className: ["fold-section"], "data-fold-level": level },
      children: [
        { ...heading, properties: { ...heading.properties, className: ["fold-heading"] } },
        {
          type: "element",
          tagName: "div",
          properties: { className: ["fold-content"] },
          children: foldRange(nodes.slice(index + 1, end)),
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

export const __test__ = { foldRange };
