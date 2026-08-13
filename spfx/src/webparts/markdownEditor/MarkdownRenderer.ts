import { MARKDOWN_ALLOWED_IMAGE_PROTOCOLS, MARKDOWN_ALLOWED_LINK_PROTOCOLS } from '@markdown-viewer/markdown-core';
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

export class MarkdownRenderer {
  private readonly _processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, schema)
    .use(rehypeStringify);

  public render(source: string): string {
    return this._processor.processSync(source).toString();
  }
}
