import { defaultSchema } from "rehype-sanitize";

/** A conservative schema for Markdown-embedded HTML. Event handlers, style and unsafe URLs remain disallowed. */
export const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className", "id", "title", "data-fold-level", "data-fold-id"],
    a: [...(defaultSchema.attributes?.a ?? []), "target", "rel"],
    img: [...(defaultSchema.attributes?.img ?? []), "src", "alt", "width", "height"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https", "data"],
  },
};
