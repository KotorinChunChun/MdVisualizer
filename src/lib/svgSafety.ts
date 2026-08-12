const BLOCKED_ELEMENTS = "script,foreignObject,iframe,object,embed,link,style,audio,video";

export function sanitizeSvgXml(source: string): string {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (root.localName.toLowerCase() !== "svg" || document.querySelector("parsererror")) throw new Error("有効なSVG XMLではありません。");
  root.querySelectorAll(BLOCKED_ELEMENTS).forEach((element) => element.remove());
  [root, ...root.querySelectorAll("*")].forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "style" || /^javascript:/i.test(value) || /url\(\s*(?!#)/i.test(value)) {
        element.removeAttribute(attribute.name);
      } else if ((name === "href" || name.endsWith(":href")) && value && !value.startsWith("#")) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return new XMLSerializer().serializeToString(root);
}
