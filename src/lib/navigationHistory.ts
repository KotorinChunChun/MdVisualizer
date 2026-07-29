export interface NavigationSnapshot {
  activeTabId: string | null;
  scrollTop: number;
  viewMode: string;
  presentationHeadingId: string | null;
  mediaPreview: unknown | null;
}

export interface NavigationHistory {
  back: NavigationSnapshot[];
  forward: NavigationSnapshot[];
}

export const emptyNavigationHistory = (): NavigationHistory => ({ back: [], forward: [] });

const appendLimited = (items: NavigationSnapshot[], item: NavigationSnapshot) =>
  [...items, item].slice(-100);

export function recordNavigation(
  history: NavigationHistory,
  current: NavigationSnapshot,
): NavigationHistory {
  return { back: appendLimited(history.back, current), forward: [] };
}

export function navigateBack(
  history: NavigationHistory,
  current: NavigationSnapshot,
): { history: NavigationHistory; target: NavigationSnapshot | null } {
  const target = history.back[history.back.length - 1] ?? null;
  if (!target) return { history, target: null };
  return {
    target,
    history: {
      back: history.back.slice(0, -1),
      forward: appendLimited(history.forward, current),
    },
  };
}

export function navigateForward(
  history: NavigationHistory,
  current: NavigationSnapshot,
): { history: NavigationHistory; target: NavigationSnapshot | null } {
  const target = history.forward[history.forward.length - 1] ?? null;
  if (!target) return { history, target: null };
  return {
    target,
    history: {
      back: appendLimited(history.back, current),
      forward: history.forward.slice(0, -1),
    },
  };
}

