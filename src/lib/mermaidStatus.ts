export type MermaidRenderState = "pending" | "rendered" | "error";

export interface MermaidBlockStatus {
  state: MermaidRenderState;
  error?: string;
}

export interface MermaidStatusSnapshot {
  pending: number;
  rendered: number;
  error: number;
  errorCount: number;
  blocks: Readonly<Record<string, MermaidBlockStatus>>;
}

type Subscriber = (snapshot: MermaidStatusSnapshot) => void;

const blocks = new Map<string, MermaidBlockStatus>();
const subscribers = new Set<Subscriber>();

function snapshot(): MermaidStatusSnapshot {
  let pending = 0;
  let rendered = 0;
  let error = 0;
  const blockSnapshot: Record<string, MermaidBlockStatus> = {};
  for (const [id, status] of blocks) {
    blockSnapshot[id] = { ...status };
    if (status.state === "pending") pending += 1;
    if (status.state === "rendered") rendered += 1;
    if (status.state === "error") error += 1;
  }
  return { pending, rendered, error, errorCount: error, blocks: blockSnapshot };
}

function notify(): void {
  const current = snapshot();
  subscribers.forEach((subscriber) => subscriber(current));
}

/** Records a block state. This module intentionally has no React dependency. */
export function setMermaidBlockStatus(id: string, status: MermaidBlockStatus): void {
  blocks.set(id, status);
  notify();
}

/** Removes an unmounted block so aggregate status only describes the current document. */
export function removeMermaidBlockStatus(id: string): void {
  if (blocks.delete(id)) notify();
}

export function getMermaidStatus(): MermaidStatusSnapshot {
  return snapshot();
}

export function subscribeMermaidStatus(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  subscriber(snapshot());
  return () => subscribers.delete(subscriber);
}

/** Test-only reset; not used by production rendering. */
export function resetMermaidStatusForTests(): void {
  blocks.clear();
  notify();
}
