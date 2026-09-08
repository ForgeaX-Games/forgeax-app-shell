/** Product-owned menu data shared by web and native menu projections. */
export interface ApplicationMenuItem {
  readonly id: string;
  readonly menu: string;
  readonly group: string;
  /** Explicit section rank: extension activation order must not move sections. */
  readonly groupOrder: number;
  readonly order: number;
  /** A live getter may resolve the contributing application's current locale. */
  readonly label: string;
  readonly icon?: string;
  /** Absence retains a disabled placeholder rather than inventing a command. */
  readonly commandId?: string;
  readonly args?: unknown;
  readonly keybinding?: string;
  readonly dynamicChildCommandId?: string;
  readonly dynamicChildIdFromArg?: string;
  readonly when?: () => boolean;
  readonly enabled?: () => boolean;
  readonly checked?: () => boolean;
  readonly danger?: boolean;
  readonly children?: readonly ApplicationMenuItem[];
  readonly dynamicChildren?: () => readonly ApplicationMenuItem[];
}

export interface ApplicationMenuRegistry {
  register(item: ApplicationMenuItem): () => void;
  snapshot(menu?: string): readonly ApplicationMenuItem[];
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** One host owns one registry; no global singleton or renderer-specific state. */
export function createApplicationMenuRegistry(): ApplicationMenuRegistry {
  const entries = new Map<string, { item: ApplicationMenuItem }>();
  const listeners = new Set<() => void>();
  const snapshots = new Map<string | undefined, readonly ApplicationMenuItem[]>();
  let closed = false;
  const notify = () => {
    snapshots.clear();
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* One projection cannot block another. */ }
    }
  };
  return {
    register(item) {
      if (closed) return () => {};
      if (!Number.isFinite(item.groupOrder) || !Number.isFinite(item.order)) {
        throw new Error('Menu ordering values must be finite');
      }
      for (const current of entries.values()) {
        if (current.item.id !== item.id && current.item.menu === item.menu
          && current.item.group === item.group && current.item.groupOrder !== item.groupOrder) {
          throw new Error(`Conflicting menu section rank for ${item.menu}/${item.group}`);
        }
      }
      // Registration identity is distinct even when the same object is reused.
      const entry = { item };
      entries.set(item.id, entry);
      notify();
      return () => {
        if (entries.get(item.id) !== entry) return;
        entries.delete(item.id);
        notify();
      };
    },
    snapshot(menu) {
      let snapshot = snapshots.get(menu);
      if (!snapshot) {
        const list = [...entries.values()]
          .map(entry => entry.item)
          .filter(item => menu === undefined || item.menu === menu);
        const key = (item: ApplicationMenuItem) => JSON.stringify([item.menu, item.group]);
        const groups = new Map<string, { rank: number; index: number }>();
        for (const item of list) {
          if (!groups.has(key(item))) {
            groups.set(key(item), { rank: item.groupOrder, index: groups.size });
          }
        }
        snapshot = Object.freeze(list.sort((a, b) => {
          const first = groups.get(key(a))!;
          const second = groups.get(key(b))!;
          return first.rank - second.rank || first.index - second.index || a.order - b.order;
        }));
        snapshots.set(menu, snapshot);
      }
      return snapshot;
    },
    subscribe(listener) {
      if (closed) return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      if (closed) return;
      closed = true;
      entries.clear();
      notify();
      listeners.clear();
    },
  };
}
