import { defaultSchema } from "rehype-sanitize";

/** A conservative schema for Markdown-embedded HTML. Event handlers, style and unsafe URLs remain disallowed. */
export const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "use", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "title", "desc"],
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
    img: [...(defaultSchema.attributes?.img ?? []), "src", "alt", "width", "height", "data-obsidian-image"],
    svg: ["xmlns", "width", "height", "viewBox", "preserveAspectRatio", "role", "ariaLabel"],
    path: ["d", "fill", "stroke", "strokeWidth", "transform"],
    rect: ["x", "y", "width", "height", "rx", "ry", "fill", "stroke", "strokeWidth", "transform"],
    circle: ["cx", "cy", "r", "fill", "stroke", "strokeWidth", "transform"],
    ellipse: ["cx", "cy", "rx", "ry", "fill", "stroke", "strokeWidth", "transform"],
    line: ["x1", "y1", "x2", "y2", "stroke", "strokeWidth", "transform"],
    polyline: ["points", "fill", "stroke", "strokeWidth", "transform"],
    polygon: ["points", "fill", "stroke", "strokeWidth", "transform"],
    g: ["fill", "stroke", "strokeWidth", "transform"],
    text: ["x", "y", "dx", "dy", "fill", "stroke", "transform", "textAnchor", "fontSize", "fontFamily"],
    tspan: ["x", "y", "dx", "dy", "fill", "textAnchor"],
    use: ["href", "x", "y", "width", "height", "transform"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto", "spmd"],
    src: ["http", "https", "data"],
  },
};
