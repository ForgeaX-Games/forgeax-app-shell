/** One application host's fallback shortcuts; never installs a DOM listener. */
export interface ApplicationShortcut {
  readonly combo: string;
  /** Read live, so callers can localize with a getter without re-registering. */
  readonly label: string;
  /** Caller-owned classification used for presentation and routing guards. */
  readonly group: string;
  /** Higher priorities run first; equal priorities retain registration order. */
  readonly priority?: number;
  readonly allowInInput?: boolean;
  readonly match: (event: KeyboardEvent) => boolean;
  /** False yields the browser default, but still ends this matched route. */
  readonly run: (event: KeyboardEvent) => boolean | void;
}

export interface ApplicationShortcutRegistry {
  register(shortcut: ApplicationShortcut): () => void;
  snapshot(): readonly ApplicationShortcut[];
  dispose(): void;
}

/**
 * Holds live contributions for an existing keyboard router. The caller owns
 * contextual precedence, input/surface guards, matching and event prevention.
 * Each registration has its own identity; a retained snapshot cannot execute
 * a removed contribution or one belonging to a disposed host.
 */
export function createApplicationShortcutRegistry(): ApplicationShortcutRegistry {
  const entries = new Set<ApplicationShortcut>();
  let closed = false;
  let snapshot: readonly ApplicationShortcut[] | null = null;

  return {
    register(shortcut) {
      if (closed) return () => {};
      let active = true;
      const entry: ApplicationShortcut = Object.freeze({
        ...shortcut,
        get label() { return shortcut.label; },
        match: (event: KeyboardEvent) => !closed && active && shortcut.match(event),
        run: (event: KeyboardEvent) => !closed && active ? shortcut.run(event) : false,
      });
      entries.add(entry);
      snapshot = null;
      return () => {
        if (!active) return;
        active = false;
        entries.delete(entry);
        snapshot = null;
      };
    },
    snapshot() {
      if (snapshot === null) {
        snapshot = Object.freeze([...entries].sort(
          (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
        ));
      }
      return snapshot;
    },
    dispose() {
      if (closed) return;
      closed = true;
      entries.clear();
      snapshot = null;
    },
  };
}
