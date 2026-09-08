export interface DomMutationObserver {
  observe(target: Node, options?: MutationObserverInit): void;
  disconnect(): void;
}

export type DomMutationListener = (
  records: MutationRecord[],
  observer: DomMutationObserver,
) => void;

export interface MutationObservationOptions {
  readonly target: Node;
  readonly observerOptions: MutationObserverInit;
  readonly onMutation: DomMutationListener;
  readonly createObserver?: (listener: DomMutationListener) => DomMutationObserver;
}

/**
 * Observe DOM mutations without owning target identity or record interpretation.
 * App Shell owns observer setup, balance, stale-callback fencing, and failure isolation.
 */
export function installMutationObservation(
  options: MutationObservationOptions,
): () => void {
  const createObserver = options.createObserver ?? (
    typeof MutationObserver === 'undefined'
      ? undefined
      : (listener: DomMutationListener) => new MutationObserver(
          (records, observer) => listener(records, observer),
        )
  );

  let active = true;
  let observer: DomMutationObserver | undefined;
  const onMutation: DomMutationListener = (records, source) => {
    if (!active) return;
    try { options.onMutation(records, source); } catch { /* caller interpretation stays isolated */ }
  };

  if (createObserver) {
    try {
      observer = createObserver(onMutation);
      observer.observe(options.target, options.observerOptions);
    } catch {
      active = false;
      try { observer?.disconnect(); } catch { /* setup rollback stays isolated */ }
      observer = undefined;
    }
  }

  return () => {
    if (!active) return;
    active = false;
    try { observer?.disconnect(); } catch { /* cleanup stays isolated */ }
    observer = undefined;
  };
}
