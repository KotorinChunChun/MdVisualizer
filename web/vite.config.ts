import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react(), {
    name: "web-browser-capabilities",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer?.replaceAll("\\", "/").includes("/src/components/")) return null;
      if (source === "../lib/commands") return path.resolve(here, "src", "browserCommands.ts");
      if (source === "../lib/path") return path.resolve(here, "src", "browserPath.ts");
      return null;
    },
  }],
  resolve: { alias: [
    { find: "@/lib/commands", replacement: path.resolve(here, "src", "browserCommands.ts") },
    { find: "@/lib/path", replacement: path.resolve(here, "src", "browserPath.ts") },
    { find: "@", replacement: path.resolve(here, "..", "src") },
  ] },
  build: { outDir: path.resolve(here, "dist"), emptyOutDir: true, rollupOptions: { output: { inlineDynamicImports: true } } },
});
