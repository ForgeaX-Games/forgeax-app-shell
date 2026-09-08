import { useMemo, useSyncExternalStore } from 'react';

export interface TabPinnedStateSource {
  pinnedIn(groupId: string): string | undefined;
  subscribe(listener: () => void): () => void;
}

export interface StableTabPinnedStateSource {
  getSnapshot(): boolean;
  subscribe(listener: () => void): () => void;
}

export function stabilizeTabPinnedStateSource(
  source: TabPinnedStateSource,
  groupId: string,
  panelId: string,
): StableTabPinnedStateSource {
  let snapshot = false;
  try {
    snapshot = source.pinnedIn(groupId) === panelId;
  } catch {
    // A product adapter that is not ready yet projects as unpinned.
  }

  const synchronize = (): boolean => {
    let next: boolean;
    try {
      next = source.pinnedIn(groupId) === panelId;
    } catch {
      return false;
    }
    if (next === snapshot) return false;
    snapshot = next;
    return true;
  };

  return {
    getSnapshot: () => {
      synchronize();
      return snapshot;
    },
    subscribe: (listener) => {
      let active = true;
      const notify = (): void => {
        if (!active || !synchronize()) return;
        try {
          listener();
        } catch {
          // One React subscriber cannot escape into the product source.
        }
      };

      let dispose = (): void => {};
      try {
        dispose = source.subscribe(notify);
      } catch {
        notify();
        return () => {
          if (!active) return;
          active = false;
        };
      }

      notify();
      return () => {
        if (!active) return;
        active = false;
        try {
          dispose();
        } catch {
          // Product adapters cannot break React cleanup.
        }
      };
    },
  };
}

/** Observe whether one product-supplied panel identity is pinned in a group. */
export function useTabPinnedState(
  source: TabPinnedStateSource,
  groupId: string,
  panelId: string,
): boolean {
  const stable = useMemo(
    () => stabilizeTabPinnedStateSource(source, groupId, panelId),
    [source, groupId, panelId],
  );
  return useSyncExternalStore(
    stable.subscribe,
    stable.getSnapshot,
    stable.getSnapshot,
  );
}
