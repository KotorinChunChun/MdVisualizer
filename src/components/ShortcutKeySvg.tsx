import { buildShortcutKeySvg, type ShortcutKeySvgOptions } from "@mdvisualizer/markdown-core";

interface ShortcutKeySvgProps extends ShortcutKeySvgOptions {
  source: string;
}

export function ShortcutKeySvg({ source, variant = "inline" }: ShortcutKeySvgProps) {
  const svg = buildShortcutKeySvg(source, { variant });
  return <span className={`shortcut-key-render shortcut-key-render--${variant}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
