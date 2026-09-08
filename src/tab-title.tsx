import { useMemo, useSyncExternalStore } from 'react';

export interface LiveTabTitleSource {
  getTitle(): string | undefined;
  subscribe(listener: () => void): () => void;
}

export interface StableLiveTabTitleSource {
  getSnapshot(): string | undefined;
  subscribe(listener: () => void): () => void;
}

export function stabilizeLiveTabTitleSource(
  source: LiveTabTitleSource,
): StableLiveTabTitleSource {
  let snapshot: string | undefined;
  try {
    snapshot = source.getTitle();
  } catch {
    snapshot = undefined;
  }

  const synchronize = (): boolean => {
    let next: string | undefined;
    try {
      next = source.getTitle();
    } catch {
      return false;
    }
    if (Object.is(snapshot, next)) return false;
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

/**
 * Observe one live tab title without owning its identity or display policy.
 *
 * The post-subscription read closes the gap between render and listener
 * installation. A generation fence prevents retained listeners from a
 * replaced source from publishing stale values.
 */
export function useLiveTabTitle(source: LiveTabTitleSource): string | undefined {
  const stable = useMemo(() => stabilizeLiveTabTitleSource(source), [source]);
  return useSyncExternalStore(
    stable.subscribe,
    stable.getSnapshot,
    stable.getSnapshot,
  );
}
