import { defaultSchema } from "rehype-sanitize";

/** A conservative schema for Markdown-embedded HTML. Event handlers, style and unsafe URLs remain disallowed. */
export const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // Do not allow arbitrary classes from embedded HTML. These are the classes
    // emitted by our Markdown/highlight/folding pipeline and safe language tags.
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      ["className", /^(?:language-[a-z0-9_-]+|hljs-[a-z0-9_-]+|fold-(?:section|heading|content|toggle|chevron))$/i],
      "id",
      "title",
      "data-fold-level",
      "data-fold-id",
      "data-block-id",
      "data-block-fold-id",
      "data-source-line",
    ],
    a: [...(defaultSchema.attributes?.a ?? []), "target", "rel"],
    img: [...(defaultSchema.attributes?.img ?? []), "src", "alt", "width", "height"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https", "data"],
  },
};
