import { mergeMermaidFrontmatter } from "./mergeMermaidFrontmatter";

let initialized = false;
let renderQueue: Promise<void> = Promise.resolve();

export interface MermaidRenderIdentity {
  windowId?: string;
  tabId?: string;
  blockId?: string;
  generation?: number;
}

export interface MermaidRenderOptions extends MermaidRenderIdentity {
  /** Zero-based diagram position in the current document. */
  diagramIndex?: number;
  /** Total Mermaid diagrams in the current document. */
  diagramCount?: number;
}

export const MERMAID_LIMITS = {
  sourceLength: 200_000,
  diagramsPerDocument: 200,
  edgeCount: 5_000,
} as const;

/** Creates a DOM-safe, deterministic ID for a Mermaid rendering generation. */
export function mermaidRenderId(identity: MermaidRenderIdentity, fallback = "mermaid"): string {
  const part = (value: string | number | undefined, defaultValue: string) => String(value ?? defaultValue)
    .replace(/[^A-Za-z0-9_-]/g, "-");
  return [
    part(identity.windowId, "window"),
    part(identity.tabId, "tab"),
    part(identity.blockId, fallback),
    `g${part(identity.generation, "0")}`,
  ].join("-");
}

export function mermaidInputError(source: string, options: MermaidRenderOptions = {}): string | null {
  if (source.length > MERMAID_LIMITS.sourceLength) return "Mermaid source is too large to render.";
  if ((options.diagramCount ?? 0) > MERMAID_LIMITS.diagramsPerDocument) return "This document contains too many Mermaid diagrams to render.";
  // Covers the connection operators used by Mermaid flowcharts/state diagrams.
  if ((source.match(/(?:-->|---|==>|-.->|--\)|-->|<--|<-->|==)/g)?.length ?? 0) > MERMAID_LIMITS.edgeCount) {
    return "Mermaid diagram has too many connections to render safely.";
  }
  return null;
}

export function mermaidThemeFor(appTheme: string): string {
  return ({ dark: "dark", light: "default", github: "default", solarized: "base", nord: "neutral", system: "default" } as Record<string, string>)[appTheme] ?? "default";
}

/**
 * Renders one diagram at a time. Mermaid keeps global mutable render state, so
 * serialising calls avoids cross-block ID and theme races. The three-argument
 * form remains supported for existing callers.
 */
export function renderMermaid(source: string, id: string, theme: string, options: MermaidRenderOptions = {}): Promise<string> {
  const limitError = mermaidInputError(source, options);
  if (limitError) return Promise.reject(new Error(limitError));

  const task = async (): Promise<string> => {
    const mermaid = (await import("mermaid")).default;
    if (!initialized) {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true });
      initialized = true;
    }
    const result = await mermaid.render(id, mergeMermaidFrontmatter(source, mermaidThemeFor(theme)));
    return result.svg;
  };

  const result = renderQueue.then(task, task);
  // Keep the queue alive after a failed diagram while returning the original
  // rejection to this caller.
  renderQueue = result.then(() => undefined, () => undefined);
  return result;
}

/** Test-only reset for isolated mocked Mermaid instances. */
export function resetMermaidServiceForTests(): void {
  initialized = false;
  renderQueue = Promise.resolve();
}
