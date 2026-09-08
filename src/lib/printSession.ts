export interface MermaidPrintStatus {
  pending: number;
}

export interface MermaidPrintWaitResult {
  timedOut: boolean;
}

export type PrintDevice = () => void | Promise<void>;

/** OS印刷と非同期PDF出力で共用する。出力完了前にはDOMを復元しない。 */
export function executePrintSession({
  print = () => window.print(),
  restore,
  events = window,
  fallbackMs = 1_000,
}: {
  print?: PrintDevice;
  restore: () => void;
  events?: EventTarget;
  fallbackMs?: number;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let finished = false;
    let deviceCompleted = false;
    let afterPrintReceived = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (failure?: { error: unknown }) => {
      if (finished) return;
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
      events.removeEventListener("afterprint", afterPrint);
      try {
        restore();
        if (failure) reject(failure.error);
        else resolve();
      } catch (error) { reject(error); }
    };
    const afterPrint = () => {
      afterPrintReceived = true;
      if (deviceCompleted) finish();
    };
    const deviceComplete = () => {
      deviceCompleted = true;
      if (afterPrintReceived) finish();
      else timer = setTimeout(() => finish(), fallbackMs);
    };
    events.addEventListener("afterprint", afterPrint);
    try {
      const result = print();
      if (result && typeof result.then === "function") {
        void result.then(deviceComplete, (error) => finish({ error }));
      } else deviceComplete();
    } catch (error) { finish({ error }); }
  });
}

/**
 * Creates a print-session restore callback that can safely be called from
 * both `afterprint` and a fallback timeout without restoring twice.
 */
export function createIdempotentPrintRestorer<T>(
  getSnapshot: () => T | null,
  onRestore: (snapshot: T) => void,
): () => boolean {
  let restored = false;
  return () => {
    if (restored) return false;
    restored = true;
    const snapshot = getSnapshot();
    if (snapshot) onRestore(snapshot);
    return true;
  };
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
