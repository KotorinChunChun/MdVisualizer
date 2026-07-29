import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { nextHeadingId } from "./headingIds";

type MarkdownAstNode = {
  type?: string;
  depth?: number;
  value?: string;
  children?: MarkdownAstNode[];
  position?: {
    start: { line: number; offset?: number };
    end: { line: number; offset?: number };
  };
};

export interface PresentationHeading {
  id: string;
  title: string;
  level: number;
  headingStart: number;
  bodyStart: number;
  bodyEnd: number;
  sectionEnd: number;
  bodyLineCount: number;
  parentId: string | null;
  childIds: string[];
}

export interface PresentationCrumb {
  id: string;
  title: string;
  index: number;
  total: number;
}

export interface PresentationPage {
  id: string;
  title: string;
  markdown: string;
  childIds: string[];
  mergedChildId: string | null;
  mergedHeadingIds: string[];
  breadcrumbs: PresentationCrumb[];
  sourceLine: number;
  /** Parent pages with child navigation intentionally omit their own body. */
  isNavigationPage: boolean;
}

export interface PresentationModel {
  headings: Record<string, PresentationHeading>;
  pages: PresentationPage[];
  rootIds: string[];
}

const parser = unified().use(remarkParse).use(remarkGfm);

function nodeText(node: MarkdownAstNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(nodeText).join("");
}

function trimmedLogicalLineCount(markdown: string) {
  const trimmed = markdown.replace(/^\s*\r?\n/, "").replace(/\s+$/, "");
  return trimmed ? trimmed.split(/\r?\n/).length : 0;
}

export function buildPresentationModel(
  markdown: string,
  inlineChildLineLimit = 10,
): PresentationModel {
  const root = parser.parse(markdown) as MarkdownAstNode;
  const astHeadings = (root.children ?? []).filter((node) => node.type === "heading" && node.position);
  if (!astHeadings.length) {
    return {
      headings: {},
      rootIds: [],
      pages: [{
        id: "document",
        title: "ドキュメント",
        markdown,
        childIds: [],
        mergedChildId: null,
        mergedHeadingIds: [],
        breadcrumbs: [],
        sourceLine: 1,
        isNavigationPage: false,
      }],
    };
  }

  const counts = new Map<string, number>();
  const list: PresentationHeading[] = astHeadings.map((node, index) => {
    const id = nextHeadingId(counts, nodeText(node));
    const headingStart = node.position!.start.offset ?? 0;
    const bodyStart = node.position!.end.offset ?? headingStart;
    const nextHeading = astHeadings[index + 1];
    const bodyEnd = nextHeading?.position?.start.offset ?? markdown.length;
    return {
      id,
      title: nodeText(node).trim() || "無題の見出し",
      level: node.depth ?? 1,
      headingStart,
      bodyStart,
      bodyEnd,
      sectionEnd: markdown.length,
      bodyLineCount: trimmedLogicalLineCount(markdown.slice(bodyStart, bodyEnd)),
      parentId: null,
      childIds: [],
    };
  });

  const stack: PresentationHeading[] = [];
  for (const heading of list) {
    while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) {
      heading.parentId = parent.id;
      parent.childIds.push(heading.id);
    }
    stack.push(heading);
  }
  for (let index = 0; index < list.length; index += 1) {
    const heading = list[index];
    heading.sectionEnd = list.slice(index + 1).find((candidate) => candidate.level <= heading.level)?.headingStart ?? markdown.length;
  }

  const headings = Object.fromEntries(list.map((heading) => [heading.id, heading]));
  const definitions = (root.children ?? [])
    .filter((node) => node.type === "definition" && node.position?.start.offset !== undefined && node.position.end.offset !== undefined)
    .map((node) => markdown.slice(node.position!.start.offset!, node.position!.end.offset!));
  const withDefinitions = (fragment: string) => {
    const missingDefinitions = definitions.filter((definition) => !fragment.includes(definition));
    return [fragment, ...missingDefinitions].filter(Boolean).join("\n\n");
  };
  const mergedIds = new Set<string>();
  const pageChains = new Map<string, PresentationHeading[]>();
  for (const heading of list) {
    if (mergedIds.has(heading.id)) continue;
    const chain = [heading];
    let current = heading;
    let cumulativeBodyLines = heading.bodyLineCount;
    while (current.childIds.length === 1) {
      const child = headings[current.childIds[0]];
      if (cumulativeBodyLines + child.bodyLineCount > inlineChildLineLimit) break;
      chain.push(child);
      mergedIds.add(child.id);
      cumulativeBodyLines += child.bodyLineCount;
      current = child;
    }
    pageChains.set(heading.id, chain);
  }

  const siblingsOf = (heading: PresentationHeading) =>
    heading.parentId ? headings[heading.parentId].childIds : list.filter((candidate) => !candidate.parentId).map((candidate) => candidate.id);
  const breadcrumbsFor = (heading: PresentationHeading) => {
    const chain: PresentationHeading[] = [];
    for (let current: PresentationHeading | undefined = heading; current; current = current.parentId ? headings[current.parentId] : undefined) {
      chain.unshift(current);
    }
    return chain.map((item) => {
      const siblings = siblingsOf(item);
      return { id: item.id, title: item.title, index: siblings.indexOf(item.id) + 1, total: siblings.length };
    });
  };

  const pages = list.filter((heading) => !mergedIds.has(heading.id)).map((heading): PresentationPage => {
    const chain = pageChains.get(heading.id) ?? [heading];
    const mergedHeadings = chain.slice(1);
    const terminalHeading = chain[chain.length - 1];
    const isNavigationPage = mergedHeadings.length === 0 && heading.childIds.length > 0;
    // A parent with selectable children is deliberately a navigation page:
    // long/multiple child sections must not mix its body into the slide.
    const ownMarkdown = markdown.slice(
      heading.headingStart,
      isNavigationPage ? heading.bodyStart : heading.bodyEnd,
    ).trim();
    const mergedMarkdown = mergedHeadings
      .map((mergedHeading) => markdown.slice(mergedHeading.headingStart, mergedHeading.bodyEnd).trim())
      .filter(Boolean)
      .join("\n\n");
    return {
      id: heading.id,
      title: heading.title,
      markdown: withDefinitions([ownMarkdown, mergedMarkdown].filter(Boolean).join("\n\n")),
      childIds: terminalHeading.childIds,
      mergedChildId: mergedHeadings[0]?.id ?? null,
      mergedHeadingIds: mergedHeadings.map((item) => item.id),
      breadcrumbs: breadcrumbsFor(terminalHeading),
      sourceLine: astHeadings[list.indexOf(heading)].position?.start.line ?? 1,
      isNavigationPage,
    };
  });

  return {
    headings,
    pages,
    rootIds: list.filter((heading) => !heading.parentId).map((heading) => heading.id),
  };
}
