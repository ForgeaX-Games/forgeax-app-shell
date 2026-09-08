import { useMemo, useSyncExternalStore } from 'react';

export interface LiveTabPlacement {
  readonly isEdge: boolean;
  readonly groupId: string;
}

export interface LiveTabPlacementSource {
  getPlacement(): LiveTabPlacement;
  subscribe(listener: () => void): () => void;
}

export interface StableLiveTabPlacementSource {
  getSnapshot(): LiveTabPlacement | undefined;
  subscribe(listener: () => void): () => void;
}

function samePlacement(
  left: LiveTabPlacement | undefined,
  right: LiveTabPlacement | undefined,
): boolean {
  return left?.isEdge === right?.isEdge && left?.groupId === right?.groupId;
}

export function stabilizeLiveTabPlacementSource(
  source: LiveTabPlacementSource,
): StableLiveTabPlacementSource {
  let snapshot: LiveTabPlacement | undefined;
  try {
    const initial = source.getPlacement();
    snapshot = Object.freeze({ isEdge: initial.isEdge, groupId: initial.groupId });
  } catch {
    snapshot = undefined;
  }

  const synchronize = (): boolean => {
    let next: LiveTabPlacement;
    try {
      next = source.getPlacement();
    } catch {
      return false;
    }
    if (samePlacement(snapshot, next)) return false;
    snapshot = Object.freeze({ isEdge: next.isEdge, groupId: next.groupId });
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

/** Observe one tab's live edge/group placement without owning host identities. */
export function useLiveTabPlacement(
  source: LiveTabPlacementSource,
): LiveTabPlacement | undefined {
  const stable = useMemo(() => stabilizeLiveTabPlacementSource(source), [source]);
  return useSyncExternalStore(
    stable.subscribe,
    stable.getSnapshot,
    stable.getSnapshot,
  );
}
