export interface ElementResizeObserver {
  observe(target: Element): void;
  disconnect(): void;
}

export interface ElementResizeObservationOptions {
  /** Read the complete live element set whenever the source changes. */
  readonly getElements: () => Iterable<Element>;
  /** Subscribe to element-set replacement. Omit when the set is fixed for this lifecycle. */
  readonly subscribeElements?: (listener: () => void) => () => void;
  /** Receive size changes without transferring geometry policy. */
  readonly onResize: () => void;
  /** Receive element-set changes after the observer has rebound. */
  readonly onElementsChanged?: () => void;
  readonly createObserver?: (listener: () => void) => ElementResizeObserver;
}

/**
 * Observe a fixed or replaceable set of elements without owning their identity or layout.
 * The caller supplies the source and effects; App Shell owns observer binding,
 * optional source subscription balance, stale-listener fencing, and failure isolation.
 */
export function installElementResizeObservation(
  options: ElementResizeObservationOptions,
): () => void {
  const createObserver = options.createObserver ?? (
    typeof ResizeObserver === 'undefined'
      ? undefined
      : (listener: () => void) => new ResizeObserver(listener)
  );

  let active = true;
  let observer: ElementResizeObserver | undefined;
  let unsubscribe: (() => void) | undefined;
  let rebinding = false;
  let rebindPending = false;
  let rebindGeneration = 0;

  const disconnect = (): void => {
    try { observer?.disconnect(); } catch { /* observer cleanup stays isolated */ }
  };

  const observeCurrent = (clearExisting = true): boolean => {
    if (!active) return false;
    rebindPending = true;
    if (rebinding) {
      rebindGeneration++;
      return false;
    }

    rebinding = true;
    let clearBeforePass = clearExisting;
    let committed = false;
    try {
      while (active && rebindPending) {
        rebindPending = false;
        committed = false;
        const generation = ++rebindGeneration;
        if (!observer) {
          committed = true;
          continue;
        }
        if (clearBeforePass) disconnect();
        clearBeforePass = true;
        if (!active || generation !== rebindGeneration || rebindPending) continue;

        let elements: Iterable<Element>;
        try { elements = options.getElements(); } catch { continue; }
        if (!active || generation !== rebindGeneration || rebindPending) continue;
        try {
          for (const element of elements) {
            if (!active || generation !== rebindGeneration || rebindPending) break;
            try { observer.observe(element); } catch { /* one invalid target does not hide later targets */ }
          }
        } catch { /* malformed iterables stay isolated */ }
        if (!active || generation !== rebindGeneration || rebindPending) continue;
        committed = true;
      }
    } finally {
      rebinding = false;
    }
    return active && committed && !rebindPending;
  };

  const onResize = (): void => {
    if (!active) return;
    try { options.onResize(); } catch { /* caller layout work stays isolated */ }
  };

  const onElementsChanged = (): void => {
    if (!active) return;
    if (!observeCurrent()) return;
    try { options.onElementsChanged?.(); } catch { /* caller layout work stays isolated */ }
  };

  if (createObserver) {
    try { observer = createObserver(onResize); } catch { observer = undefined; }
  }
  observeCurrent(false);

  if (options.subscribeElements) {
    try {
      unsubscribe = options.subscribeElements(onElementsChanged);
      if (typeof unsubscribe !== 'function') {
        throw new TypeError('element source subscription must return a disposer');
      }
    } catch {
      active = false;
      disconnect();
      try { unsubscribe?.(); } catch { /* setup rollback stays isolated */ }
      unsubscribe = undefined;
    }
  }

  return () => {
    if (!active) return;
    active = false;
    try { unsubscribe?.(); } catch { /* source cleanup stays isolated */ }
    unsubscribe = undefined;
    disconnect();
    observer = undefined;
  };
}
