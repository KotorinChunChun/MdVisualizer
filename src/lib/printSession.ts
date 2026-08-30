export interface MermaidPrintStatus {
  pending: number;
}

export interface MermaidPrintWaitResult {
  timedOut: boolean;
}

/** Waits for Mermaid renderers without coupling the print flow to React state. */
export async function waitForMermaidPrintReady(
  getStatus: () => MermaidPrintStatus,
  timeoutMs = 5_000,
  intervalMs = 50,
): Promise<MermaidPrintWaitResult> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (getStatus().pending > 0 && Date.now() < deadline) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(1, intervalMs)));
  }
  return { timedOut: getStatus().pending > 0 };
}
