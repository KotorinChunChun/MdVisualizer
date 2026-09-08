import {
  MARKDOWN_ALLOWED_IMAGE_PROTOCOLS,
  MARKDOWN_ALLOWED_LINK_PROTOCOLS,
  normalizeStructuredListIndentationForRendering
} from '@markdown-viewer/markdown-core';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema, type Options } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

const schema: Options = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...(defaultSchema.attributes?.['*'] || []),
      ['className', /^(?:language-[a-z0-9_-]+|hljs(?:-[a-z0-9_-]+)?)$/i],
      'id',
      'title'
    ],
    a: [...(defaultSchema.attributes?.a || []), 'target', 'rel'],
    img: [...(defaultSchema.attributes?.img || []), 'src', 'alt', 'width', 'height']
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...MARKDOWN_ALLOWED_LINK_PROTOCOLS],
    src: [...MARKDOWN_ALLOWED_IMAGE_PROTOCOLS]
  }
};

interface IHastNode {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: IHastNode[];
}

function rehypeListMarkerDepth(): (tree: IHastNode) => void {
  return tree => {
    const visit = (node: IHastNode, depth: number): void => {
      const isList = node.type === 'element' && (node.tagName === 'ol' || node.tagName === 'ul');
      if (node.type === 'element' && node.tagName === 'ul') {
        node.properties ||= {};
        const current = node.properties.className;
        const classes = Array.isArray(current) ? current : typeof current === 'string' ? current.split(/\s+/) : [];
        node.properties.className = [...classes, depth % 2 === 0 ? 'markdown-list-marker-even' : 'markdown-list-marker-odd'];
      }
      node.children?.forEach(child => visit(child, isList ? depth + 1 : depth));
    };
    visit(tree, 0);
  };
}

export class MarkdownRenderer {
  private readonly _processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, schema)
    .use(rehypeListMarkerDepth)
    .use(rehypeStringify);

  public render(source: string): string {
    return this._processor.processSync(normalizeStructuredListIndentationForRendering(source)).toString();
  }
}
