import type { Cleanup, PanelActionContribution } from './application';

interface Entry<T> {
  readonly owner: string;
  readonly actions: readonly T[];
}

export interface PanelActionRegistry<T extends PanelActionContribution = PanelActionContribution> {
  contribute(owner: string, actions: readonly T[]): Cleanup;
  list(panelId: string): readonly T[];
  all(): readonly T[];
  onChange(listener: () => void): Cleanup;
  version(): number;
}

export function createPanelActionRegistry<T extends PanelActionContribution = PanelActionContribution>(): PanelActionRegistry<T> {
  const entries: Entry<T>[] = [];
  const listeners = new Set<() => void>();
  let cache: readonly T[] | null = null;
  let version = 0;

  const emit = (): void => {
    cache = null;
    version++;
    for (const listener of [...listeners]) listener();
  };

  // Batch-deferred notification: data mutations (push/splice) happen
  // immediately so reads (list/all) always return fresh data, but listener
  // notifications are deferred to a microtask. This avoids triggering
  // forceStoreRerender (useSyncExternalStore) during React 19's commit
  // phase, which otherwise causes "Maximum update depth exceeded".
  let emitScheduled = false;
  const scheduleEmit = (): void => {
    cache = null;
    if (emitScheduled) return;
    emitScheduled = true;
    queueMicrotask(() => {
      emitScheduled = false;
      emit();
    });
  };

  const all = (): readonly T[] => {
    if (cache) return cache;
    cache = entries.flatMap((entry) => entry.actions).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return cache;
  };

  return {
    contribute(owner, actions) {
      const entry: Entry<T> = { owner, actions };
      entries.push(entry);
      scheduleEmit();
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        const index = entries.indexOf(entry);
        if (index >= 0) entries.splice(index, 1);
        scheduleEmit();
      };
    },
    list(panelId) {
      return all().filter((action) => action.panelId === panelId);
    },
    all,
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    version() {
      return version;
    },
  };
}
